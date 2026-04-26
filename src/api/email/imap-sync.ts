import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { bulkUpsertEmails, type EmailRow } from './email-store.js';
import {
  GMAIL_SYNC_BASE_POLL_INTERVAL_MS,
  formatGmailSyncError,
  isPermanentOAuthError,
  nextGmailSyncDelayMs,
} from './gmail-sync-backoff.js';
import { sendTelegramAlert } from '../alerts/telegram.js';

// ─── OAuth2 설정 (라이브러리 없이 직접) ───────────────────────
const CLIENT_SECRET_PATH = '/home/ubuntu/.config/gws/client_secret.json';
const TOKEN_PATH = resolve(process.cwd(), 'gmail-token.json');
const HISTORY_PATH = resolve(process.cwd(), 'gmail-history-id.txt');
const POLL_INTERVAL = GMAIL_SYNC_BASE_POLL_INTERVAL_MS;
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface Tokens { access_token: string; refresh_token: string; expiry_date: number; }
let _tokens: Tokens | null = null;

function loadTokens(): Tokens {
  if (_tokens) return _tokens;
  _tokens = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  return _tokens!;
}

function saveTokens(t: Tokens) {
  _tokens = t;
  writeFileSync(TOKEN_PATH, JSON.stringify(t, null, 2));
}

async function refreshAccessToken(): Promise<string> {
  const tokens = loadTokens();
  const creds = JSON.parse(readFileSync(CLIENT_SECRET_PATH, 'utf8')).installed;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as any;
  if (!data.access_token) {
    const error = typeof data.error === 'string' ? data.error : 'unknown_error';
    const description = typeof data.error_description === 'string' ? data.error_description : res.statusText;
    throw new Error(`토큰 갱신 실패: ${error}${description ? ` (${description})` : ''}`);
  }

  tokens.access_token = data.access_token;
  tokens.expiry_date = Date.now() + (data.expires_in || 3600) * 1000;
  saveTokens(tokens);
  console.log('[gmail-sync] 토큰 갱신 완료');
  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (tokens.expiry_date > Date.now() + 60000) return tokens.access_token;
  return refreshAccessToken();
}

async function gmailGet(path: string, params?: Record<string, string>): Promise<any> {
  const token = await getAccessToken();
  const url = new URL(`${GMAIL_API}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    // 토큰 만료 → 갱신 후 재시도
    const newToken = await refreshAccessToken();
    const res2 = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    return res2.json();
  }
  return res.json();
}

// ─── 파싱 헬퍼 ────────────────────────────────────────────────
function dh(v: string) {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, _c, enc, en) => {
    try { return enc.toUpperCase()==='B'?Buffer.from(en,'base64').toString('utf-8'):en.replace(/_/g,' ').replace(/=([0-9A-Fa-f]{2})/g,(_:string,h:string)=>String.fromCharCode(parseInt(h,16))); }
    catch { return en; }
  });
}

// ─── Gmail 메시지 → EmailRow ──────────────────────────────────
function extractBody(part: any): { html: string | null; text: string | null } {
  let html: string | null = null;
  let text: string | null = null;

  function walk(p: any) {
    const mime = p.mimeType || '';
    if (p.parts) { for (const sub of p.parts) walk(sub); return; }
    const data = p.body?.data;
    if (!data) return;
    const decoded = Buffer.from(data, 'base64url').toString('utf-8');
    if (mime.includes('text/html') && !html) html = decoded;
    if (mime.includes('text/plain') && !text) text = decoded;
  }
  walk(part);
  return { html, text };
}

function parseGmailMsg(msg: any): EmailRow | null {
  try {
    const hdr: Record<string, string> = {};
    for (const h of (msg.payload?.headers || [])) {
      const k = h.name.toLowerCase();
      if (!hdr[k]) hdr[k] = h.value;
    }
    if (!hdr['x-simplelogin-type']?.match(/Forward/i)) return null;

    const { html, text } = extractBody(msg.payload);
    const tsSec = msg.internalDate ? Math.floor(Number(msg.internalDate) / 1000) : 0;
    const numId = parseInt(msg.id, 16) || 0;

    return {
      uid: numId % 2147483647,
      alias_to: hdr['x-simplelogin-envelope-to'] || hdr['delivered-to'] || hdr['to'] || '',
      from_addr: hdr['from'] || '',
      original_from: dh(hdr['x-simplelogin-original-from'] || hdr['reply-to'] || hdr['from'] || ''),
      subject: dh(hdr['subject'] || ''),
      html, text_body: text,
      date_str: hdr['date'] || '',
      timestamp_sec: tsSec,
      fetched_at: Date.now(),
    };
  } catch { return null; }
}

// ─── 전체 메시지 fetch ────────────────────────────────────────
export async function fetchGmailMessage(msgId: string): Promise<any> {
  return gmailGet(`/messages/${msgId}`, { format: 'full' });
}

// ─── historyId 관리 ───────────────────────────────────────────
let _historyId: string | null = null;

function loadHistoryId(): string | null {
  try { return existsSync(HISTORY_PATH) ? readFileSync(HISTORY_PATH, 'utf8').trim() : null; }
  catch { return null; }
}
function saveHistoryId(id: string) {
  try { writeFileSync(HISTORY_PATH, id); } catch { /**/ }
}

// ─── 초기 sync ────────────────────────────────────────────────
async function initialSync() {
  console.log('[gmail-sync] 초기 sync 시작...');

  const listRes = await gmailGet('/messages', {
    q: 'label:inbox newer_than:7d',
    maxResults: '100',
  });

  const messages = listRes.messages || [];
  console.log(`[gmail-sync] 최근 7일 메일 ${messages.length}개 확인`);

  const rows: EmailRow[] = [];
  for (const m of messages) {
    try {
      const full = await fetchGmailMessage(m.id);
      const row = parseGmailMsg(full);
      if (row) rows.push(row);
    } catch { /**/ }
  }

  if (rows.length) {
    await bulkUpsertEmails(rows);
    console.log(`[gmail-sync] 초기 ${rows.length}개 저장`);
  }

  // historyId 설정
  const profile = await gmailGet('/profile');
  _historyId = profile.historyId || null;
  if (_historyId) saveHistoryId(_historyId);
  console.log(`[gmail-sync] historyId: ${_historyId}`);
}

// ─── 폴링 ─────────────────────────────────────────────────────
async function pollNewMessages() {
  if (!_historyId) {
    const profile = await gmailGet('/profile');
    _historyId = profile.historyId || null;
    if (_historyId) saveHistoryId(_historyId);
    return;
  }

  const res = await gmailGet('/history', {
    startHistoryId: _historyId,
    historyTypes: 'messageAdded',
  });

  if (res.error?.code === 404) {
    console.warn('[gmail-sync] historyId 만료 → 재설정');
    _historyId = null;
    return;
  }

  const newHid = res.historyId;
  if (newHid) { _historyId = newHid; saveHistoryId(newHid); }

  const histories = res.history || [];
  if (!histories.length) return;

  const newIds = new Set<string>();
  for (const h of histories) {
    for (const added of (h.messagesAdded || [])) {
      if (added.message?.id) newIds.add(added.message.id);
    }
  }
  if (!newIds.size) return;

  console.log(`[gmail-sync] 새 메일 ${newIds.size}개 감지`);
  const rows: EmailRow[] = [];
  for (const id of newIds) {
    try {
      const full = await fetchGmailMessage(id);
      const row = parseGmailMsg(full);
      if (row) rows.push(row);
    } catch { /**/ }
  }
  if (rows.length) {
    await bulkUpsertEmails(rows);
    console.log(`[gmail-sync] ${rows.length}개 저장`);
  }
}

// ─── 메인 ─────────────────────────────────────────────────────
let _running = false;
let _consecutiveSyncErrors = 0;
let _firstSyncErrorAt = 0;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function recordGmailSyncError(phase: string, error: unknown): Promise<number> {
  _consecutiveSyncErrors += 1;
  if (!_firstSyncErrorAt) _firstSyncErrorAt = Date.now();
  const delay = nextGmailSyncDelayMs(_consecutiveSyncErrors, error);
  const message = formatGmailSyncError(error);
  console.error(`[gmail-sync] ${phase} 오류: ${message}; 다음 재시도 ${Math.round(delay / 1000)}초 후`);
  if (isPermanentOAuthError(error)) {
    await sendTelegramAlert({
      key: 'gmail-sync:invalid_grant',
      title: 'Gmail 동기화 재인증 필요',
      message: 'Gmail OAuth refresh token이 invalid_grant로 거부되었습니다. Gmail 재인증이 필요합니다.',
      details: { phase, error: message, consecutiveErrors: _consecutiveSyncErrors },
    });
  }
  if (Date.now() - _firstSyncErrorAt >= 10 * 60 * 1000) {
    await sendTelegramAlert({
      key: 'gmail-sync:failing-10m',
      title: 'Gmail 동기화 10분 이상 실패',
      message: 'Gmail 동기화 실패가 10분 이상 지속되고 있습니다.',
      details: { phase, error: message, consecutiveErrors: _consecutiveSyncErrors },
    });
  }
  return delay;
}

async function clearGmailSyncErrors() {
  if (_consecutiveSyncErrors > 0) {
    console.log('[gmail-sync] 복구됨');
    await sendTelegramAlert({
      key: 'gmail-sync:recovered',
      title: 'Gmail 동기화 복구',
      message: 'Gmail 동기화가 정상 상태로 복구되었습니다.',
      details: { consecutiveErrors: _consecutiveSyncErrors },
    });
  }
  _consecutiveSyncErrors = 0;
  _firstSyncErrorAt = 0;
}

export async function startGmailSync() {
  if (!existsSync(CLIENT_SECRET_PATH) || !existsSync(TOKEN_PATH)) {
    console.warn('[gmail-sync] OAuth 파일 없음');
    return;
  }
  if (_running) return;
  _running = true;
  console.log('[gmail-sync] 시작 (15초 간격)');

  _historyId = loadHistoryId();
  let nextDelay = POLL_INTERVAL;
  try {
    await initialSync();
    await clearGmailSyncErrors();
  } catch (e: unknown) {
    nextDelay = await recordGmailSyncError('초기', e);
  }

  (async () => {
    while (_running) {
      await sleep(nextDelay);
      try {
        await pollNewMessages();
        await clearGmailSyncErrors();
        nextDelay = POLL_INTERVAL;
      } catch (e: unknown) {
        nextDelay = await recordGmailSyncError('폴링', e);
      }
    }
  })().catch(e => console.error('[gmail-sync] 루프 오류:', formatGmailSyncError(e)));
}

export function stopGmailSync() { _running = false; }

// ─── 하위 호환 ───────────────────────────────────────────────
export function isSyncBusy(): boolean { return false; }
export function getSharedClient() { return null; }
export function setSharedClient(_c: any) {}
export function setSyncBusy(_b: boolean) {}
export const startImapSync = startGmailSync;
export const stopImapSync = stopGmailSync;
