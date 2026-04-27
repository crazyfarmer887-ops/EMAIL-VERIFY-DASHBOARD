import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from "hono/cors";
import { fetchRawEmail } from './email/raw-email.ts';
import { getSubjectList, getEmailList, getEmailByUid, getLatestEmailReceivedAt } from './email/email-store.ts';
import { sendTelegramAlert } from './alerts/telegram.ts';
import { extractAuthCode } from '../lib/auth-code-extractor.ts';
import { fetchAllSimpleLoginAliases } from './simplelogin-aliases.ts';

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;

    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!key || value === '') continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const app = new Hono().basePath('/api');
app.use(cors({ origin: "*" }));

const SL_API = 'https://app.simplelogin.io/api';
const SL_KEY = (globalThis as any).SIMPLELOGIN_API_KEY || process.env.SIMPLELOGIN_API_KEY || '';
const slHeaders = () => ({ 'Authentication': SL_KEY, 'Content-Type': 'application/json' });

// 인메모리 캐시 (Cloudflare Workers 인스턴스 내 유지)
const cache = new Map<string, { data: any; ts: number }>();
const ALIAS_TTL    = 30 * 60 * 1000; // 별칭 목록: 30분
const ACTIVITY_TTL = 1 * 60 * 1000; // 활동 내역: 1분 (새 메일 빠르게 반영)

function getCached(key: string, ttl: number) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return hit.data;
  return null;
}
function setCached(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

const PIN_STORE_PATH = resolve(process.cwd(), 'data', 'alias-pins.json');
const GMAIL_TOKEN_PATH = resolve(process.cwd(), 'gmail-token.json');
const GMAIL_HISTORY_PATH = resolve(process.cwd(), 'gmail-history-id.txt');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEFAULT_ADMIN_SESSION_SECRET = 'graytag-admin-session-dev-secret';
const DEFAULT_UNLOCK_TOKEN_SECRET = 'graytag-unlock-token-dev-secret';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function isWeakSecret(value: string, weakValues: string[] = []) {
  return !value || value.length < 32 || weakValues.includes(value);
}

function resolveSecret(name: string, fallback: string, weakValues: string[] = []) {
  const value = process.env[name] || (!IS_PRODUCTION ? fallback : '');
  if (IS_PRODUCTION && isWeakSecret(value, [fallback, ADMIN_PASSWORD, ...weakValues].filter(Boolean))) {
    throw new Error(`[security] ${name} must be set to a strong secret in production.`);
  }
  return value;
}

const ADMIN_SESSION_SECRET=resolveSecret('ADMIN_SESSION_SECRET', ADMIN_PASSWORD || DEFAULT_ADMIN_SESSION_SECRET, [DEFAULT_ADMIN_SESSION_SECRET]);
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24시간
const ADMIN_SESSION_MAX_AGE_SEC = Math.floor(ADMIN_SESSION_TTL_MS / 1000);

function warnIfWeakSecret(name: string, value: string, weakValues: string[]) {
  if (!IS_PRODUCTION && isWeakSecret(value, weakValues)) {
    console.warn(`[security] ${name} is missing or weak; set a strong environment secret for production.`);
  }
}

function isHttpsRequest(c: any) {
  const forwardedProto = String(c.req.header('x-forwarded-proto') || '').split(',')[0]?.trim().toLowerCase();
  if (forwardedProto === 'https') return true;
  const url = new URL(c.req.url);
  return url.protocol === 'https:';
}

function adminSessionCookie(value: string, maxAgeSec: number, c: any) {
  const secure = isHttpsRequest(c) || IS_PRODUCTION ? '; Secure' : '';
  return `graytag_admin_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

warnIfWeakSecret('ADMIN_SESSION_SECRET', ADMIN_SESSION_SECRET, [DEFAULT_ADMIN_SESSION_SECRET, ADMIN_PASSWORD].filter(Boolean));

// TODO(security): replace plaintext PIN persistence with a one-way hash + migration.
type PinRecord = { pin: string; updatedAt: string };
let pinStoreCache: Record<string, PinRecord> | null = null;

function ensurePinStoreDir() {
  const dir = dirname(PIN_STORE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadPinStore(): Record<string, PinRecord> {
  if (pinStoreCache) return pinStoreCache;
  if (!existsSync(PIN_STORE_PATH)) {
    pinStoreCache = {};
    return pinStoreCache;
  }
  try {
    const raw = readFileSync(PIN_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, PinRecord>;
    pinStoreCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    pinStoreCache = {};
  }
  return pinStoreCache;
}

function savePinStore(store: Record<string, PinRecord>) {
  ensurePinStoreDir();
  pinStoreCache = store;
  writeFileSync(PIN_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function readTextFileSafe(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function getFileMtimeIso(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
}

function getProtectedAliasCount() {
  return Object.values(loadPinStore()).filter(record => !!record?.pin).length;
}

function getGmailStatus(warnings: string[]) {
  const historyId = readTextFileSafe(GMAIL_HISTORY_PATH)?.trim() || null;
  const lastSync = getFileMtimeIso(GMAIL_HISTORY_PATH);
  const rawToken = readTextFileSafe(GMAIL_TOKEN_PATH);
  let tokenOk = false;
  let lastError: string | null = null;

  if (!rawToken) {
    lastError = 'Gmail token file is missing';
    warnings.push('Gmail token file is missing');
  } else {
    try {
      const token = JSON.parse(rawToken) as { expiry_date?: unknown };
      const expiryDate = Number(token.expiry_date || 0);
      if (!Number.isFinite(expiryDate) || expiryDate <= 0) {
        lastError = 'Gmail token expiry is unavailable';
        warnings.push('Gmail token expiry is unavailable');
      } else if (expiryDate <= Date.now()) {
        lastError = 'Gmail token is expired';
        warnings.push('Gmail token is expired');
      } else {
        tokenOk = true;
      }
    } catch {
      lastError = 'Gmail token file is unreadable';
      warnings.push('Gmail token file is unreadable');
    }
  }

  if (!historyId) warnings.push('Gmail history id is missing');
  return { ok: tokenOk && !!historyId, lastSync, historyId, lastError };
}

async function getEmailStatus(warnings: string[]) {
  try {
    return { lastReceivedAt: await getLatestEmailReceivedAt() };
  } catch {
    warnings.push('Email store latest timestamp is unavailable');
    return { lastReceivedAt: null };
  }
}

function getSellerStatusWarnings(warnings: string[]) {
  return Array.from(new Set(warnings));
}

function getAliasPin(aliasId: number | string): string | null {
  return loadPinStore()[String(aliasId)]?.pin || null;
}

function hasAliasPin(aliasId: number | string): boolean {
  return !!getAliasPin(aliasId);
}

function aliasWithPinStatus(alias: any) {
  if (!alias || typeof alias !== 'object') return alias;
  const { pin: _pin, ...safeAlias } = alias;
  return { ...safeAlias, hasPin: hasAliasPin(alias.id) };
}

function setAliasPin(aliasId: number | string, pin: string) {
  const store = loadPinStore();
  store[String(aliasId)] = { pin, updatedAt: new Date().toISOString() };
  savePinStore(store);
}

function removeAliasPin(aliasId: number | string) {
  const store = loadPinStore();
  delete store[String(aliasId)];
  savePinStore(store);
}

function parseCookies(cookieHeader: string | null | undefined) {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function issueAdminToken() {
  const exp = Date.now() + ADMIN_SESSION_TTL_MS;
  const payload = String(exp);
  const sig = createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token: string | undefined | null) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('hex');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  if (!timingSafeEqual(left, right)) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now();
}

function isAdminRequest(c: any) {
  const cookies = parseCookies(c.req.header('cookie'));
  return verifyAdminToken(cookies.graytag_admin_session);
}

function requireAdmin(c: any) {
  if (!ADMIN_PASSWORD) return c.json({ error: '관리자 비밀번호가 설정되지 않았어요' }, 500);
  if (!isAdminRequest(c)) return c.json({ error: '관리자 로그인이 필요해요' }, 401);
  return null;
}

function normalizePinInput(pin: string) {
  return pin.trim().replace(/\s+/g, '');
}

app.get('/admin/session', (c) => {
  if (!ADMIN_PASSWORD) return c.json({ authenticated: false, configured: false });
  return c.json({ authenticated: isAdminRequest(c), configured: true });
});

app.post('/admin/login', async (c) => {
  if (!ADMIN_PASSWORD) return c.json({ error: '관리자 비밀번호가 설정되지 않았어요' }, 500);
  const body = await c.req.json().catch(() => ({} as any));
  const password = String(body?.password || '');
  if (!password) return c.json({ error: '비밀번호를 입력해주세요' }, 400);
  if (password !== ADMIN_PASSWORD) return c.json({ error: '비밀번호가 틀렸어요' }, 401);

  const token = issueAdminToken();
  return c.json(
    { ok: true },
    200,
    {
      'Set-Cookie': adminSessionCookie(token, ADMIN_SESSION_MAX_AGE_SEC, c),
    },
  );
});

app.post('/admin/logout', (c) => c.json({ ok: true }, 200, {
  'Set-Cookie': adminSessionCookie('', 0, c),
}));

// ─── 서버 사이드 Unlock 토큰 (alias별, guest별, 30분) ──────────
const UNLOCK_TOKEN_SECRET=resolveSecret('UNLOCK_TOKEN_SECRET', ADMIN_PASSWORD || DEFAULT_UNLOCK_TOKEN_SECRET, [DEFAULT_UNLOCK_TOKEN_SECRET]);
warnIfWeakSecret('UNLOCK_TOKEN_SECRET', UNLOCK_TOKEN_SECRET, [DEFAULT_UNLOCK_TOKEN_SECRET, ADMIN_PASSWORD].filter(Boolean));
const UNLOCK_TTL_MS = 30 * 60 * 1000;

function issueUnlockToken(aliasId: string, guestId: string): string {
  if (!guestId) throw new Error('guestId 필요');
  const exp = Date.now() + UNLOCK_TTL_MS;
  // payload를 JSON으로 직렬화하여 ':' 구분자 충돌 방지
  const payload = Buffer.from(JSON.stringify({ aliasId, guestId, exp })).toString('base64url');
  const sig = createHmac('sha256', UNLOCK_TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyUnlockToken(token: string, aliasId: string, guestId: string): boolean {
  try {
    if (!token || !aliasId || !guestId) return false;
    const lastDot = token.lastIndexOf('.');
    if (lastDot < 0) return false;
    const payload = token.slice(0, lastDot);
    const sig = token.slice(lastDot + 1);
    // HMAC 검증
    const expected = createHmac('sha256', UNLOCK_TOKEN_SECRET).update(payload).digest('hex');
    const l = Buffer.from(sig, 'hex'), r = Buffer.from(expected, 'hex');
    if (l.length !== r.length || !timingSafeEqual(l, r)) return false;
    // payload 디코딩 및 클레임 검증
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (claims.aliasId !== aliasId) return false;
    if (claims.guestId !== guestId) return false;
    if (Date.now() >= Number(claims.exp)) return false;
    return true;
  } catch { return false; }
}

const PIN_FAILURE_LIMIT = 5;
const PIN_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const PIN_LOCKOUT_MS = 2 * 60 * 1000;
type PinFailureEntry = { count: number; firstFailureAt: number; lockedUntil: number };
const pinFailures = new Map<string, PinFailureEntry>();

function getServerObservedIp(c: any) {
  const raw: any = c.req.raw;
  return String(raw?.ip || raw?.socket?.remoteAddress || c.env?.remoteAddress || 'unknown').trim() || 'unknown';
}

function pinFailureKeys(aliasId: string, guestId: string, c: any) {
  const ip = getServerObservedIp(c);
  return [
    `alias:${aliasId}`,
    `alias:${aliasId}:ip:${ip}`,
    `alias:${aliasId}:guest:${guestId}`,
  ];
}

function getPinLockout(key: string, now = Date.now()) {
  const entry = pinFailures.get(key);
  if (!entry) return null;
  if (entry.lockedUntil > now) return entry;
  if (entry.lockedUntil || now - entry.firstFailureAt > PIN_FAILURE_WINDOW_MS) {
    pinFailures.delete(key);
    return null;
  }
  if (entry.count >= PIN_FAILURE_LIMIT) {
    entry.lockedUntil = now + PIN_LOCKOUT_MS;
    pinFailures.set(key, entry);
    return entry;
  }
  return entry;
}

function recordPinFailure(key: string, now = Date.now()) {
  const existing = pinFailures.get(key);
  const entry = existing && now - existing.firstFailureAt <= PIN_FAILURE_WINDOW_MS
    ? existing
    : { count: 0, firstFailureAt: now, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count > PIN_FAILURE_LIMIT) entry.lockedUntil = now + PIN_LOCKOUT_MS;
  pinFailures.set(key, entry);
  return entry;
}

function clearPinFailures(key: string) {
  pinFailures.delete(key);
}

async function notifyPinLockout(aliasId: string, guestId: string, c: any, entry: PinFailureEntry) {
  await sendTelegramAlert({
    key: `pin-lockout:${aliasId}`,
    title: 'PIN brute force lockout 발생',
    message: '이메일 별칭 PIN 검증이 반복 실패로 잠겼습니다.',
    details: {
      aliasId,
      guestId,
      observedIp: getServerObservedIp(c),
      failures: entry.count,
      lockedUntil: new Date(entry.lockedUntil).toISOString(),
    },
  });
}

function pinLockedResponse(c: any, entry: PinFailureEntry) {
  const retryAfter = Math.max(1, Math.ceil((entry.lockedUntil - Date.now()) / 1000));
  return c.json(
    { ok: false, matched: false, locked: true, retryAfter },
    429,
    { 'Retry-After': String(retryAfter) },
  );
}

app.post('/sl/aliases/:id/pin/verify', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({} as any));
  const pin = normalizePinInput(String(body?.pin || ''));
  if (!pin) return c.json({ error: 'PIN을 입력해주세요' }, 400);

  const guestId = String(body?.guestId || '').trim();
  if (!guestId) return c.json({ error: 'guestId가 필요해요' }, 400);

  const stored = getAliasPin(id);
  if (!stored) return c.json({ error: 'PIN이 설정되지 않은 이메일이에요' }, 404);

  const failureKeys = pinFailureKeys(id, guestId, c);
  const locked = failureKeys.map(key => getPinLockout(key)).find(entry => entry?.lockedUntil);
  if (locked?.lockedUntil) {
    await notifyPinLockout(id, guestId, c, locked);
    return pinLockedResponse(c, locked);
  }

  if (stored !== pin) {
    const failures = failureKeys.map(key => recordPinFailure(key));
    const lockedFailure = failures.find(entry => entry.lockedUntil);
    if (lockedFailure) {
      await notifyPinLockout(id, guestId, c, lockedFailure);
      return pinLockedResponse(c, lockedFailure);
    }
    return c.json({ ok: false, matched: false }, 401);
  }

  failureKeys.forEach(clearPinFailures);
  const unlockToken = issueUnlockToken(id, guestId);
  return c.json({ ok: true, matched: true, unlockToken });
});

// unlock 토큰 검증 엔드포인트
app.post('/sl/aliases/:id/pin/check', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({} as any));
  const { unlockToken, guestId } = body;
  if (!unlockToken || !guestId) return c.json({ valid: false });
  return c.json({ valid: verifyUnlockToken(String(unlockToken), id, String(guestId)) });
});

// hasPin 실시간 조회 (캐시 우회 - PIN 설정/해제 직후 정확한 상태 반환)
app.get('/sl/aliases/:id/pin/status', async (c) => {
  const { id } = c.req.param();
  return c.json({ hasPin: !!getAliasPin(id) });
});

function extractEmailAddress(value: string) {
  return (value.match(/<([^>]+)>/)?.[1] || value).trim().toLowerCase();
}

function getAccessParam(c: any, name: string) {
  return String(c.req.header(name) || c.req.query(name) || '').trim();
}

async function getSimpleLoginAliasEmail(aliasId: string): Promise<string | null> {
  const cached = getCached(`alias_${aliasId}`, ALIAS_TTL);
  if (cached?.email) return String(cached.email);
  try {
    const res = await fetch(`${SL_API}/aliases/${aliasId}`, { headers: slHeaders() });
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (!data?.error) setCached(`alias_${aliasId}`, data);
    return data?.email ? String(data.email) : null;
  } catch {
    return null;
  }
}

async function requireEmailAliasAccess(c: any, alias: string) {
  if (isAdminRequest(c)) return null;

  const aliasId = getAccessParam(c, 'x-sl-alias-id') || getAccessParam(c, 'aliasId');
  if (!aliasId) return c.json({ error: '이메일 접근 인증이 필요해요' }, 403);

  const aliasEmail = await getSimpleLoginAliasEmail(aliasId);
  if (!aliasEmail) return c.json({ error: '이메일 접근 인증을 확인할 수 없어요' }, 403);
  if (extractEmailAddress(aliasEmail) !== extractEmailAddress(alias)) {
    return c.json({ error: '이메일 접근 권한이 없어요' }, 403);
  }

  if (!hasAliasPin(aliasId)) return null;

  const cookies = parseCookies(c.req.header('cookie'));
  const unlockToken = getAccessParam(c, 'x-sl-unlock-token') || getAccessParam(c, 'unlockToken');
  const guestId = getAccessParam(c, 'x-sl-guest-id') || getAccessParam(c, 'guestId') || cookies.sl_guest_id || '';
  if (verifyUnlockToken(unlockToken, aliasId, guestId)) return null;
  return c.json({ error: 'PIN 인증이 필요해요' }, 403);
}

app.put('/admin/pins/:id', async (c) => {
  const adminErr = requireAdmin(c);
  if (adminErr) return adminErr;

  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({} as any));
  const pin = normalizePinInput(String(body?.pin || ''));
  if (!/^\d{4,12}$/.test(pin)) return c.json({ error: 'PIN은 숫자 4~12자리로 입력해주세요' }, 400);

  setAliasPin(id, pin);
  return c.json({ ok: true, hasPin: true });
});

app.delete('/admin/pins/:id', (c) => {
  const adminErr = requireAdmin(c);
  if (adminErr) return adminErr;

  const { id } = c.req.param();
  removeAliasPin(id);
  return c.json({ ok: true, hasPin: false });
});

// SimpleLogin - 별칭 목록
app.get('/sl/aliases', async (c) => {
  const page = Number(c.req.query('page') || '0');
  const force = c.req.query('force') === '1';
  const all = c.req.query('all') !== '0';
  const cacheKey = all ? `aliases_all_${page}` : `aliases_${page}`;

  if (!force) {
    const cached = getCached(cacheKey, ALIAS_TTL);
    if (cached) {
      const aliases = Array.isArray(cached.aliases)
        ? cached.aliases.map(aliasWithPinStatus)
        : cached.aliases;
      return c.json({ ...cached, aliases, _cached: true });
    }
  }

  try {
    const fetchAliasPage = async (pageId: number) => {
      const res = await fetch(`${SL_API}/aliases?page_id=${pageId}`, { headers: slHeaders() });
      if (res.status === 429) throw new Error('RATE_LIMIT');
      return await res.json() as any;
    };
    const data = all
      ? await fetchAllSimpleLoginAliases(fetchAliasPage, { startPage: Number.isFinite(page) ? page : 0 })
      : await fetchAliasPage(Number.isFinite(page) ? page : 0);

    if (!data.error) setCached(cacheKey, data);
    const aliases = Array.isArray(data.aliases)
      ? data.aliases.map(aliasWithPinStatus)
      : data.aliases;
    return c.json({ ...data, aliases });
  } catch (e: any) {
    if (e?.message === 'RATE_LIMIT') {
      const cached = getCached(cacheKey, Infinity); // rate limit 시 만료된 캐시라도 반환
      if (cached) {
        const aliases = Array.isArray(cached.aliases)
          ? cached.aliases.map(aliasWithPinStatus)
          : cached.aliases;
        return c.json({ ...cached, aliases, _cached: true, _rate_limited: true });
      }
      return c.json({ error: 'API 요청 한도 초과. 잠시 후 다시 시도해주세요.', aliases: [] }, 429);
    }
    return c.json({ error: e.message }, 500);
  }
});

// SimpleLogin - 특정 별칭 상세
app.get('/sl/aliases/:id', async (c) => {
  const { id } = c.req.param();
  const cacheKey = `alias_${id}`;
  const cached = getCached(cacheKey, ALIAS_TTL);
  if (cached) return c.json({ ...cached, _cached: true });
  try {
    const res = await fetch(`${SL_API}/aliases/${id}`, { headers: slHeaders() });
    if (res.status === 429) {
      const c2 = getCached(cacheKey, Infinity);
      if (c2) return c.json({ ...c2, _cached: true, _rate_limited: true });
      return c.json({ error: 'API 요청 한도 초과' }, 429);
    }
    const data = await res.json() as any;
    if (!data.error) setCached(cacheKey, data);
    return c.json({ ...data, hasPin: hasAliasPin(id) });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// SimpleLogin - 특정 별칭의 활동
app.get('/sl/aliases/:id/activities', async (c) => {
  const { id } = c.req.param();
  const page = c.req.query('page') || '0';
  const force = c.req.query('force') === '1';
  const cacheKey = `activities_${id}_${page}`;

  if (!force) {
    const cached = getCached(cacheKey, ACTIVITY_TTL);
    if (cached) return c.json({ ...cached, _cached: true });
  }

  try {
    const res = await fetch(`${SL_API}/aliases/${id}/activities?page_id=${page}`, { headers: slHeaders() });
    if (res.status === 429) {
      const cached = getCached(cacheKey, Infinity);
      if (cached) return c.json({ ...cached, _cached: true, _rate_limited: true });
      return c.json({ error: 'API 요청 한도 초과. 잠시 후 다시 시도해주세요.', activities: [] }, 429);
    }
    const data = await res.json() as any;
    if (!data.error) setCached(cacheKey, data);
    return c.json(data);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.get('/seller/status', async (c) => {
  const adminErr = requireAdmin(c);
  if (adminErr) return adminErr;

  const warnings: string[] = [];
  const gmail = getGmailStatus(warnings);
  const email = await getEmailStatus(warnings);
  const uniqueWarnings = getSellerStatusWarnings(warnings);
  return c.json({
    ok: gmail.ok && uniqueWarnings.length === 0,
    generatedAt: new Date().toISOString(),
    gmail,
    pins: { protectedAliases: getProtectedAliasCount() },
    email,
    warnings: uniqueWarnings,
  });
});

app.get('/ping', (c) => c.json({ ok: true }));

// 원본 이메일 HTML 조회 - DB 우선, IMAP fallback
app.get('/email/raw', async (c) => {
  const alias = c.req.query('alias') || '';
  const from  = c.req.query('from')  || '';
  const ts    = Number(c.req.query('ts') || '0');
  if (!alias) return c.json({ error: 'alias 파라미터 필요' }, 400);
  if (!ts) return c.json({ error: 'ts 파라미터 필요' }, 400);
  const accessErr = await requireEmailAliasAccess(c, alias);
  if (accessErr) return accessErr;
  try {
    const data = await fetchRawEmail(alias, from, ts);
    if (!data) return c.json({ error: '이메일을 찾을 수 없어요' }, 404);
    return c.json({
      ...data,
      extractedAuth: extractAuthCode({ subject: data.subject, text: data.text, html: data.html }),
    });
  } catch (e: any) {
    return c.json({ error: `메일 조회 실패: ${e.message}` }, 500);
  }
});

// alias의 subject 목록 bulk 조회 (mail-detail subject 로딩용)
app.get('/email/subjects', async (c) => {
  const alias = c.req.query('alias') || '';
  const limit = Math.min(Number(c.req.query('limit') || '30'), 50);
  if (!alias) return c.json({ error: 'alias 파라미터 필요' }, 400);
  const accessErr = await requireEmailAliasAccess(c, alias);
  if (accessErr) return accessErr;
  try {
    const subjects = await getSubjectList(alias, limit);
    return c.json({ subjects });
  } catch (e: any) {
    return c.json({ subjects: [], error: e.message });
  }
});

// alias의 메일 목록 (DB 직접 조회 — 제목 정확)
app.get('/email/list', async (c) => {
  const alias = c.req.query('alias') || '';
  const limit = Math.min(Number(c.req.query('limit') || '50'), 100);
  if (!alias) return c.json({ error: 'alias 파라미터 필요' }, 400);
  const accessErr = await requireEmailAliasAccess(c, alias);
  if (accessErr) return accessErr;
  try {
    const emails = await getEmailList(alias, limit);
    return c.json({
      emails: emails.map(e => ({
        uid: e.uid,
        subject: e.subject,
        from_addr: e.from_addr,
        original_from: e.original_from,
        alias_to: e.alias_to,
        date_str: e.date_str,
        timestamp_sec: Number(e.timestamp_sec),
        extractedAuth: extractAuthCode({ subject: e.subject, text: e.text_body, html: e.html }),
      })),
    });
  } catch (e: any) {
    return c.json({ emails: [], error: e.message });
  }
});

// uid로 단일 이메일 조회 (정확한 1:1)
app.get('/email/uid/:uid', async (c) => {
  const uid = Number(c.req.param('uid'));
  if (!uid || !isFinite(uid)) return c.json({ error: 'uid 파라미터 필요' }, 400);
  try {
    const row = await getEmailByUid(uid);
    if (!row) return c.json({ error: '이메일을 찾을 수 없어요' }, 404);
    const accessErr = await requireEmailAliasAccess(c, row.alias_to);
    if (accessErr) return accessErr;
    return c.json({
      uid: row.uid,
      subject: row.subject,
      from: row.from_addr,
      originalFrom: row.original_from,
      aliasTo: row.alias_to,
      date: row.date_str,
      html: row.html,
      text: row.text_body,
      timestamp_sec: Number(row.timestamp_sec),
      extractedAuth: extractAuthCode({ subject: row.subject, text: row.text_body, html: row.html }),
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
