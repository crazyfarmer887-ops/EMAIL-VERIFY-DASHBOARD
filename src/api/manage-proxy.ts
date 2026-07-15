import { createHash } from 'node:crypto';
import type { Context } from 'hono';

const AIO_MANAGEMENT_URL = 'http://127.0.0.1:6931/my/management';
const COOKIE_NAMES = ['AWSALB', 'AWSALBCORS', 'JSESSIONID'] as const;
const MAX_COOKIE_LENGTH = 4096;
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_STRING_LENGTH = 4096;
const MAX_RATE_LIMIT_BUCKETS = 10_000;

const rateLimits = new Map<string, { count: number; resetAt: number }>();
let activeRateLimitPolicy = '';

type GraytagCookies = Record<(typeof COOKIE_NAMES)[number], string>;

type JsonRecord = Record<string, unknown>;

function positiveInteger(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function observedClient(c: Context) {
  const raw = c.req.raw as Request & { ip?: string; socket?: { remoteAddress?: string } };
  return String(raw.ip || raw.socket?.remoteAddress || c.env?.remoteAddress || 'unknown').trim() || 'unknown';
}

function rateLimitResponse(c: Context, sessionId: string) {
  const now = Date.now();
  const max = positiveInteger(process.env.MANAGE_PROXY_RATE_LIMIT_MAX, 30);
  const windowMs = positiveInteger(process.env.MANAGE_PROXY_RATE_LIMIT_WINDOW_MS, 60_000);
  const policy = `${process.cwd()}\0${max}\0${windowMs}`;
  if (policy !== activeRateLimitPolicy) {
    rateLimits.clear();
    activeRateLimitPolicy = policy;
  }

  rateLimits.forEach((entry, bucket) => {
    if (entry.resetAt <= now) rateLimits.delete(bucket);
  });

  const sessionDigest = createHash('sha256').update(sessionId).digest('base64url');
  const key = `${observedClient(c)}:${sessionDigest}`;
  const previous = rateLimits.get(key);
  const entry = !previous || previous.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : previous;
  entry.count += 1;
  rateLimits.delete(key);
  rateLimits.set(key, entry);
  while (rateLimits.size > MAX_RATE_LIMIT_BUCKETS) {
    const oldest = rateLimits.keys().next().value;
    if (oldest === undefined) break;
    rateLimits.delete(oldest);
  }
  if (entry.count <= max) return null;

  const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  return c.json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' }, 429, {
    'Retry-After': String(retryAfter),
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type LimitedBodyResult =
  | { exceeded: false; text: string }
  | { exceeded: true; text?: never };

export async function readLimitedBody(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<LimitedBodyResult> {
  if (!stream) return { exceeded: false, text: '' };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { exceeded: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { exceeded: false, text: new TextDecoder().decode(bytes) };
}

function isValidCookieValue(value: string) {
  // RFC 6265 cookie-octet: compatible with AWS ALB/base64-like values while
  // excluding whitespace, quotes, comma, semicolon, backslash, and controls.
  return value.length > 0 && /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/.test(value);
}

function parseCookieBody(value: unknown): GraytagCookies | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== COOKIE_NAMES.length || keys.some((key) => !COOKIE_NAMES.includes(key as typeof COOKIE_NAMES[number]))) {
    return null;
  }

  const parsed = {} as GraytagCookies;
  for (const name of COOKIE_NAMES) {
    const cookie = value[name];
    if (typeof cookie !== 'string' || cookie.length > MAX_COOKIE_LENGTH || !isValidCookieValue(cookie)) {
      return null;
    }
    parsed[name] = cookie;
  }
  if (!parsed.JSESSIONID) return null;
  return parsed;
}

function safeString(value: unknown, nullable = false): string | null | undefined {
  if (nullable && value === null) return null;
  return typeof value === 'string' && value.length <= MAX_RESPONSE_STRING_LENGTH ? value : undefined;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeMember(value: unknown) {
  if (!isRecord(value)) return null;
  const dealUsid = safeString(value.dealUsid);
  const name = safeString(value.name, true);
  const status = safeString(value.status);
  const statusName = safeString(value.statusName);
  const price = safeString(value.price);
  const purePrice = safeNumber(value.purePrice);
  const realizedSum = safeNumber(value.realizedSum);
  const progressRatio = safeString(value.progressRatio);
  const startDateTime = safeString(value.startDateTime, true);
  const endDateTime = safeString(value.endDateTime, true);
  const remainderDays = safeNumber(value.remainderDays);
  const source = value.source;
  if (dealUsid === undefined || name === undefined || status === undefined || statusName === undefined
    || price === undefined || purePrice === undefined || realizedSum === undefined || progressRatio === undefined
    || startDateTime === undefined || endDateTime === undefined || remainderDays === undefined
    || (source !== 'after' && source !== 'before')) return null;
  return {
    dealUsid, name, status, statusName, price, purePrice, realizedSum, progressRatio,
    startDateTime, endDateTime, remainderDays, source,
  };
}

function sanitizeAccount(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.members)) return null;
  const email = safeString(value.email);
  const serviceType = safeString(value.serviceType);
  const members = value.members.map(sanitizeMember);
  const usingCount = safeNumber(value.usingCount);
  const activeCount = safeNumber(value.activeCount);
  const totalSlots = safeNumber(value.totalSlots);
  const totalIncome = safeNumber(value.totalIncome);
  const totalRealizedIncome = safeNumber(value.totalRealizedIncome);
  const expiryDate = safeString(value.expiryDate, true);
  if (email === undefined || serviceType === undefined || members.some((member) => member === null)
    || usingCount === undefined || activeCount === undefined || totalSlots === undefined
    || totalIncome === undefined || totalRealizedIncome === undefined || expiryDate === undefined) return null;
  return {
    email, serviceType, members, usingCount, activeCount, totalSlots,
    totalIncome, totalRealizedIncome, expiryDate,
  };
}

function sanitizeService(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.accounts)) return null;
  const serviceType = safeString(value.serviceType);
  const accounts = value.accounts.map(sanitizeAccount);
  const totalUsingMembers = safeNumber(value.totalUsingMembers);
  const totalActiveMembers = safeNumber(value.totalActiveMembers);
  const totalIncome = safeNumber(value.totalIncome);
  const totalRealized = safeNumber(value.totalRealized);
  if (serviceType === undefined || accounts.some((account) => account === null)
    || totalUsingMembers === undefined || totalActiveMembers === undefined
    || totalIncome === undefined || totalRealized === undefined) return null;
  return { serviceType, accounts, totalUsingMembers, totalActiveMembers, totalIncome, totalRealized };
}

function sanitizeManagementResponse(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.services) || !isRecord(value.summary)) return null;
  const services = value.services.map(sanitizeService);
  const totalUsingMembers = safeNumber(value.summary.totalUsingMembers);
  const totalActiveMembers = safeNumber(value.summary.totalActiveMembers);
  const totalIncome = safeNumber(value.summary.totalIncome);
  const totalRealized = safeNumber(value.summary.totalRealized);
  const totalAccounts = safeNumber(value.summary.totalAccounts);
  const updatedAt = safeString(value.updatedAt);
  if (services.some((service) => service === null) || totalUsingMembers === undefined
    || totalActiveMembers === undefined || totalIncome === undefined || totalRealized === undefined
    || totalAccounts === undefined || updatedAt === undefined) return null;
  return {
    services,
    summary: { totalUsingMembers, totalActiveMembers, totalIncome, totalRealized, totalAccounts },
    updatedAt,
  };
}

function mappedUpstreamError(c: Context, status: number, retryAfterHeader: string | null) {
  if (status === 401) {
    return c.json({ error: 'Graytag 로그인 정보가 만료되었어요' }, 401);
  }
  if (status === 403) {
    return c.json({ error: '관리 조회 서비스 인증에 실패했어요' }, 502);
  }
  if (status === 429) {
    const parsed = Number(retryAfterHeader);
    const retryAfter = Number.isInteger(parsed) && parsed > 0 && parsed <= 86_400 ? parsed : 60;
    return c.json({ error: '관리 조회 요청이 너무 많아요. 잠시 후 다시 시도해주세요.' }, 429, {
      'Retry-After': String(retryAfter),
    });
  }
  return c.json({ error: '관리 조회 서비스를 사용할 수 없어요' }, 502);
}

export async function handleManagementProxy(c: Context) {
  const adminToken = process.env.AIO_ADMIN_TOKEN?.trim();
  if (!adminToken) return c.json({ error: '관리 조회 서비스가 설정되지 않았어요' }, 503);

  const contentType = c.req.header('content-type')?.toLowerCase() || '';
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    return c.json({ error: 'Content-Type은 application/json이어야 해요' }, 415);
  }

  const contentLength = Number(c.req.header('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return c.json({ error: '요청 본문이 너무 커요' }, 413);
  }

  const requestBody = await readLimitedBody(c.req.raw.body, MAX_REQUEST_BYTES);
  if (requestBody.exceeded) {
    return c.json({ error: '요청 본문이 너무 커요' }, 413);
  }
  const rawBody = requestBody.text;

  let rawCookies: unknown;
  try {
    rawCookies = JSON.parse(rawBody);
  } catch {
    return c.json({ error: '요청 형식이 올바르지 않아요' }, 400);
  }
  const cookies = parseCookieBody(rawCookies);
  if (!cookies) {
    const oversizedCookie = isRecord(rawCookies)
      && COOKIE_NAMES.some((name) => typeof rawCookies[name] === 'string' && rawCookies[name].length > MAX_COOKIE_LENGTH);
    return c.json({ error: oversizedCookie ? '쿠키 값이 너무 커요' : '쿠키 형식이 올바르지 않아요' }, oversizedCookie ? 413 : 400);
  }

  const limited = rateLimitResponse(c, cookies.JSESSIONID);
  if (limited) return limited;

  const controller = new AbortController();
  const clientSignal = c.req.raw.signal;
  let timedOut = false;
  const onClientAbort = () => controller.abort(clientSignal.reason);
  if (clientSignal.aborted) onClientAbort();
  else clientSignal.addEventListener('abort', onClientAbort, { once: true });
  const timeoutMs = positiveInteger(process.env.MANAGE_PROXY_TIMEOUT_MS, 8_000);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Upstream timeout', 'TimeoutError'));
  }, timeoutMs);
  try {
    const upstream = await fetch(AIO_MANAGEMENT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-token': adminToken,
      },
      body: JSON.stringify(cookies),
      redirect: 'error',
      signal: controller.signal,
    });

    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => undefined);
      return mappedUpstreamError(c, upstream.status, upstream.headers.get('retry-after'));
    }
    const contentType = upstream.headers.get('content-type')?.toLowerCase() || '';
    if (!contentType.includes('application/json')) {
      await upstream.body?.cancel().catch(() => undefined);
      return c.json({ error: '관리 조회 서비스 응답이 올바르지 않아요' }, 502);
    }
    const responseBody = await readLimitedBody(upstream.body, MAX_UPSTREAM_BYTES);
    if (responseBody.exceeded) {
      return c.json({ error: '관리 조회 서비스 응답이 너무 커요' }, 502);
    }
    const responseText = responseBody.text;
    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      return c.json({ error: '관리 조회 서비스 응답이 올바르지 않아요' }, 502);
    }
    const safeResponse = sanitizeManagementResponse(responseJson);
    if (!safeResponse) return c.json({ error: '관리 조회 서비스 응답이 올바르지 않아요' }, 502);
    return c.json(safeResponse);
  } catch (error) {
    if (timedOut) {
      return c.json({ error: '관리 조회 서비스 응답 시간이 초과되었어요' }, 504);
    }
    if (clientSignal.aborted) {
      return c.json({ error: '관리 조회 요청이 취소되었어요' }, 499 as any);
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      return c.json({ error: '관리 조회 서비스 응답 시간이 초과되었어요' }, 504);
    }
    return c.json({ error: '관리 조회 서비스에 연결할 수 없어요' }, 502);
  } finally {
    clearTimeout(timer);
    clientSignal.removeEventListener('abort', onClientAbort);
  }
}
