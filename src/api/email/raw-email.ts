import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { findEmail, upsertEmail, type EmailRow } from './email-store.ts';

const CLIENT_SECRET_PATH = '/home/ubuntu/.config/gws/client_secret.json';
const TOKEN_PATH = resolve(process.cwd(), 'gmail-token.json');
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface ParsedEmail {
  subject: string; from: string; originalFrom: string;
  date: string; html: string | null; text: string | null; aliasTo: string;
}

// ─── 토큰 관리 ────────────────────────────────────────────────
interface Tokens { access_token: string; refresh_token: string; expiry_date: number; }
interface GmailMessageListItem { id: string }
interface GmailListResponse { messages?: GmailMessageListItem[] }
interface GmailHeader { name: string; value: string }
interface GmailMessagePart { mimeType?: string; body?: { data?: string }; parts?: GmailMessagePart[]; headers?: GmailHeader[] }
interface GmailMessage { id: string; internalDate?: string; payload?: GmailMessagePart }
let _tokens: Tokens | null = null;

function loadTokens(): Tokens {
  if (_tokens && _tokens.expiry_date > Date.now() + 60000) return _tokens;
  _tokens = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  return _tokens!;
}

async function getAccessToken(): Promise<string> {
  const t = loadTokens();
  if (t.expiry_date > Date.now() + 60000) return t.access_token;
  // refresh
  const creds = JSON.parse(readFileSync(CLIENT_SECRET_PATH, 'utf8')).installed;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id, client_secret: creds.client_secret,
      refresh_token: t.refresh_token, grant_type: 'refresh_token',
    }),
  });
  const d = await res.json() as any;
  if (!d.access_token) throw new Error('토큰 갱신 실패');
  t.access_token = d.access_token;
  t.expiry_date = Date.now() + (d.expires_in || 3600) * 1000;
  _tokens = t;
  writeFileSync(TOKEN_PATH, JSON.stringify(t, null, 2));
  return t.access_token;
}

async function gmailGet<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${GMAIL_API}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    _tokens = null; // force refresh
    const t2 = await getAccessToken();
    const r2 = await fetch(url.toString(), { headers: { Authorization: `Bearer ${t2}` } });
    return r2.json();
  }
  return res.json();
}

// ─── 헬퍼 ─────────────────────────────────────────────────────
function dh(v: string) {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, _c, enc, en) => {
    try { return enc.toUpperCase()==='B'?Buffer.from(en,'base64').toString('utf-8'):en.replace(/_/g,' ').replace(/=([0-9A-Fa-f]{2})/g,(_:string,h:string)=>String.fromCharCode(parseInt(h,16))); }
    catch { return en; }
  });
}

function extractBody(part: any): { html: string | null; text: string | null } {
  let html: string | null = null, text: string | null = null;
  function walk(p: any) {
    if (p.parts) { for (const s of p.parts) walk(s); return; }
    const data = p.body?.data;
    if (!data) return;
    const decoded = Buffer.from(data, 'base64url').toString('utf-8');
    if (p.mimeType?.includes('text/html') && !html) html = decoded;
    if (p.mimeType?.includes('text/plain') && !text) text = decoded;
  }
  walk(part);
  return { html, text };
}

function rowToEmail(row: EmailRow): ParsedEmail {
  return { subject: row.subject, from: row.from_addr, originalFrom: row.original_from,
    date: row.date_str, html: row.html, text: row.text_body, aliasTo: row.alias_to };
}

// ─── Gmail API fallback ───────────────────────────────────────
async function fetchFromGmail(alias: string, from: string, tsSec: number): Promise<ParsedEmail | null> {
  const fromAddr = (from.match(/<([^>]+)>/)?.[1] || from).toLowerCase();
  const fromDomain = fromAddr.split('@')[1] || '';

  let q = `in:anywhere newer_than:1d`;
  if (alias) q += ` to:${alias}`;
  if (fromDomain) q += ` from:${fromDomain}`;

  const listRes = await gmailGet<GmailListResponse>('/messages', { q, maxResults: '20' });
  const msgs = listRes.messages || [];
  if (!msgs.length) return null;

  let bestMsg: any = null, bestDiff = Infinity;
  for (const m of msgs) {
    const full = await gmailGet<GmailMessage>(`/messages/${m.id}`, { format: 'full' });
    const msgTs = Math.floor(Number(full.internalDate) / 1000);
    const diff = Math.abs(msgTs - tsSec);
    if (diff < bestDiff) { bestDiff = diff; bestMsg = full; }
    if (diff < 30) break; // 30초 이내면 즉시 확정
  }
  if (!bestMsg || bestDiff > 600) return null; // 10분 범위 밖이면 무시

  const hdr: Record<string, string> = {};
  for (const h of (bestMsg.payload?.headers || [])) {
    const k = h.name.toLowerCase();
    if (!hdr[k]) hdr[k] = h.value;
  }
  const { html, text } = extractBody(bestMsg.payload);

  const parsed: ParsedEmail = {
    subject: dh(hdr['subject'] || ''), from: hdr['from'] || '',
    originalFrom: dh(hdr['x-simplelogin-original-from'] || hdr['reply-to'] || hdr['from'] || ''),
    date: hdr['date'] || '',
    aliasTo: hdr['x-simplelogin-envelope-to'] || hdr['delivered-to'] || hdr['to'] || '',
    html, text,
  };

  // DB 저장
  const numId = parseInt(bestMsg.id, 16) || 0;
  await upsertEmail({
    uid: numId % 2147483647, alias_to: parsed.aliasTo, from_addr: parsed.from,
    original_from: parsed.originalFrom, subject: parsed.subject,
    html: parsed.html, text_body: parsed.text, date_str: parsed.date,
    timestamp_sec: tsSec, fetched_at: Date.now(),
  });

  return parsed;
}

// ─── 메인 API ────────────────────────────────────────────────
export async function fetchRawEmail(alias: string, from: string, tsSec: number): Promise<ParsedEmail | null> {
  if (!tsSec || !isFinite(tsSec)) throw new Error('유효하지 않은 timestamp');

  // ① DB 조회 (<50ms)
  try {
    const row = await findEmail(alias, tsSec, from);
    if (row) return rowToEmail(row);
  } catch (e) {
    console.warn('[raw-email] DB 실패:', (e as Error).message);
  }

  // ② Gmail API fallback
  if (!existsSync(TOKEN_PATH)) throw new Error('Gmail OAuth 토큰 없음');
  return fetchFromGmail(alias, from, tsSec);
}
