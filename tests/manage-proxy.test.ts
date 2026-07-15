import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const originalCwd = process.cwd();
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function validCookies(overrides: Record<string, unknown> = {}) {
  return {
    AWSALB: 'alb-cookie',
    AWSALBCORS: 'cors-cookie',
    JSESSIONID: 'session-cookie',
    ...overrides,
  };
}

function validManagementResponse() {
  return {
    services: [{
      serviceType: 'Netflix',
      accounts: [{
        email: 'customer@example.test',
        serviceType: 'Netflix',
        members: [{
          dealUsid: 'deal-1', name: 'member', status: 'Using', statusName: '이용 중',
          price: '10000', purePrice: 9000, realizedSum: 1000, progressRatio: '0.5',
          startDateTime: null, endDateTime: '2026-08-01', remainderDays: 17, source: 'after',
        }],
        usingCount: 1, activeCount: 1, totalSlots: 4, totalIncome: 9000,
        totalRealizedIncome: 1000, expiryDate: '2026-08-01',
      }],
      totalUsingMembers: 1, totalActiveMembers: 1, totalIncome: 9000, totalRealized: 1000,
    }],
    summary: {
      totalUsingMembers: 1, totalActiveMembers: 1, totalIncome: 9000,
      totalRealized: 1000, totalAccounts: 1,
    },
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'manage-proxy-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  process.chdir(root);
  process.env.ADMIN_SESSION_SECRET = 'a'.repeat(40);
  process.env.UNLOCK_TOKEN_SECRET = 'u'.repeat(40);
  process.env.AIO_ADMIN_TOKEN = 'server-only-admin-token';
  process.env.PGHOST = '127.0.0.1';
  process.env.PGPORT = '5432';
  process.env.PGDATABASE = 'test-emailcache';
  process.env.PGUSER = 'test-emailapp';
  process.env.PGPASSWORD = 'test-password-not-a-real-secret';
  process.env.MANAGE_PROXY_TIMEOUT_MS = '100';
  process.env.MANAGE_PROXY_RATE_LIMIT_MAX = '30';
  process.env.MANAGE_PROXY_RATE_LIMIT_WINDOW_MS = '60000';
}

async function freshApp() {
  vi.resetModules();
  return (await import('../src/api/index.ts')).default;
}

async function post(app: Awaited<ReturnType<typeof freshApp>>, body: unknown, headers: Record<string, string> = {}) {
  return app.request('/api/my/management', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  process.chdir(originalCwd);
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('fixed-purpose AIO management proxy', () => {
  test('posts only the three Graytag cookies to the fixed loopback route with the server token', async () => {
    makeRoot();
    const upstream = validManagementResponse();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ...upstream, upstreamSecret: 'drop-me' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
    const app = await freshApp();

    const response = await post(app, validCookies());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(upstream);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:6931/my/management');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).get('x-admin-token')).toBe('server-only-admin-token');
    expect(JSON.parse(String(init?.body))).toEqual(validCookies());
  });

  test.each([301, 302, 303, 307, 308])('fails closed on upstream %i without permitting credential redirects', async (status) => {
    makeRoot();
    globalThis.fetch = vi.fn(async () => new Response('redirect-body-secret', {
      status,
      headers: { location: 'https://evil.test/collect' },
    })) as typeof fetch;
    const app = await freshApp();

    const response = await post(app, validCookies());

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('redirect-body-secret');
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(init?.redirect).toBe('error');
  });

  test.each([301, 401, 403, 429, 500])('cancels the unread upstream body on status %i', async (status) => {
    makeRoot();
    const cancelled = vi.fn();
    globalThis.fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('must-not-be-read'));
      },
      cancel: cancelled,
    }), {
      status,
      headers: status === 301
        ? { location: 'https://evil.test/collect' }
        : status === 429 ? { 'retry-after': '7' } : undefined,
    })) as typeof fetch;
    const app = await freshApp();

    await post(app, validCookies());

    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  test('requires an application/json request content type', async () => {
    makeRoot();
    globalThis.fetch = vi.fn() as typeof fetch;
    const app = await freshApp();

    const response = await post(app, JSON.stringify(validCookies()), { 'content-type': 'text/plain' });

    expect(response.status).toBe(415);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test.each([
    ['malformed JSON', '{'],
    ['array body', []],
    ['missing cookie', { AWSALB: '', AWSALBCORS: '' }],
    ['empty AWS cookie', validCookies({ AWSALB: '' })],
    ['cookie whitespace', validCookies({ AWSALB: 'has space' })],
    ['cookie delimiter', validCookies({ AWSALBCORS: 'bad;cookie' })],
    ['cookie quote', validCookies({ JSESSIONID: 'bad"cookie' })],
    ['non-string cookie', validCookies({ JSESSIONID: 123 })],
    ['extra field', { ...validCookies(), url: 'http://evil.test/' }],
  ])('rejects invalid input: %s', async (_name, body) => {
    makeRoot();
    globalThis.fetch = vi.fn() as typeof fetch;
    const app = await freshApp();

    const response = await post(app, body);

    expect(response.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('fails closed with 503 when AIO_ADMIN_TOKEN is missing', async () => {
    makeRoot();
    delete process.env.AIO_ADMIN_TOKEN;
    globalThis.fetch = vi.fn() as typeof fetch;
    const app = await freshApp();

    const response = await post(app, validCookies());

    expect(response.status).toBe(503);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('aborts a slow upstream and returns a safe 504', async () => {
    makeRoot();
    process.env.MANAGE_PROXY_TIMEOUT_MS = '10';
    globalThis.fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
    const app = await freshApp();

    const response = await post(app, validCookies());

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: '관리 조회 서비스 응답 시간이 초과되었어요' });
  });

  test('rejects a successful non-JSON upstream response without exposing its body', async () => {
    makeRoot();
    const secret = 'upstream-secret-body';
    globalThis.fetch = vi.fn(async () => new Response(secret, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as typeof fetch;
    const app = await freshApp();

    const response = await post(app, validCookies());
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain(secret);
  });

  test('cancels a chunked upstream stream immediately when its byte limit is exceeded', async () => {
    makeRoot();
    let streamCancelled = false;
    const cancelled = vi.fn(() => {
      streamCancelled = true;
    });
    globalThis.fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
        setTimeout(() => {
          if (!streamCancelled) controller.close();
        }, 20);
      },
      cancel: cancelled,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
    const app = await freshApp();

    const response = await post(app, validCookies());

    expect(response.status).toBe(502);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  test('rejects oversized request bodies before calling upstream', async () => {
    makeRoot();
    globalThis.fetch = vi.fn() as typeof fetch;
    const app = await freshApp();

    const response = await post(app, validCookies({ JSESSIONID: 'x'.repeat(4097) }));

    expect(response.status).toBe(413);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('cancels a chunked request stream immediately when its byte limit is exceeded', async () => {
    makeRoot();
    globalThis.fetch = vi.fn() as typeof fetch;
    const app = await freshApp();
    let streamCancelled = false;
    const cancelled = vi.fn(() => {
      streamCancelled = true;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16 * 1024 + 1));
        setTimeout(() => {
          if (!streamCancelled) controller.close();
        }, 20);
      },
      cancel: cancelled,
    });

    const response = await app.fetch(new Request('http://localhost/api/my/management', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }));

    expect(response.status).toBe(413);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('does not echo credentials or upstream errors in responses or logs', async () => {
    makeRoot();
    const cookies = validCookies();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    globalThis.fetch = vi.fn(async () => new Response(`failure ${cookies.JSESSIONID}`, {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    })) as typeof fetch;
    const app = await freshApp();

    const response = await post(app, cookies);
    const responseText = await response.text();
    const logged = [...log.mock.calls, ...error.mock.calls].flat().join(' ');

    expect(response.status).toBe(502);
    expect(responseText).not.toContain(String(cookies.JSESSIONID));
    expect(responseText).not.toContain('server-only-admin-token');
    expect(logged).not.toContain(String(cookies.JSESSIONID));
    expect(logged).not.toContain('server-only-admin-token');
  });

  test('rejects malformed management JSON shape', async () => {
    makeRoot();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ services: 'not-an-array' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
    const app = await freshApp();

    const response = await post(app, validCookies());

    expect(response.status).toBe(502);
  });

  test('does not charge invalid request bodies against the rate limit', async () => {
    makeRoot();
    process.env.MANAGE_PROXY_RATE_LIMIT_MAX = '1';
    globalThis.fetch = vi.fn(async () => Response.json(validManagementResponse())) as typeof fetch;
    const app = await freshApp();

    expect((await post(app, '{')).status).toBe(400);
    expect((await post(app, validCookies())).status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test('uses per-session digest buckets instead of a shared unknown-client bucket', async () => {
    makeRoot();
    process.env.MANAGE_PROXY_RATE_LIMIT_MAX = '1';
    globalThis.fetch = vi.fn(async () => Response.json(validManagementResponse())) as typeof fetch;
    const app = await freshApp();

    expect((await post(app, validCookies({ JSESSIONID: 'session-a' }))).status).toBe(200);
    expect((await post(app, validCookies({ JSESSIONID: 'session-b' }))).status).toBe(200);
    expect((await post(app, validCookies({ JSESSIONID: 'session-a' }))).status).toBe(429);
  });

  test('reads rate-limit configuration at handler time', async () => {
    makeRoot();
    process.env.MANAGE_PROXY_RATE_LIMIT_MAX = '30';
    globalThis.fetch = vi.fn(async () => Response.json(validManagementResponse())) as typeof fetch;
    const app = await freshApp();
    process.env.MANAGE_PROXY_RATE_LIMIT_MAX = '1';

    expect((await post(app, validCookies())).status).toBe(200);
    expect((await post(app, validCookies())).status).toBe(429);
  });

  test('server forwards API request bodies as streams instead of prebuffering them', () => {
    const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
    expect(source).toContain('init.body = req.body');
    expect(source).not.toContain('req.clone().arrayBuffer()');
  });

  test('rate-limits repeated management lookups', async () => {
    makeRoot();
    process.env.MANAGE_PROXY_RATE_LIMIT_MAX = '1';
    globalThis.fetch = vi.fn(async () => Response.json(validManagementResponse())) as typeof fetch;
    const app = await freshApp();

    expect((await post(app, validCookies())).status).toBe(200);
    const limited = await post(app, validCookies());

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
