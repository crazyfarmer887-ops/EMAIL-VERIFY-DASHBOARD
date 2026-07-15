import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const originalCwd = process.cwd();
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function makeRoot(pinContents?: string) {
  const root = mkdtempSync(join(tmpdir(), 'api-security-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  if (pinContents !== undefined) writeFileSync(join(root, 'data', 'alias-pins.json'), pinContents);
  process.chdir(root);
  process.env.ADMIN_PASSWORD = 'admin-pass';
  process.env.ADMIN_SESSION_SECRET = 'a'.repeat(40);
  process.env.UNLOCK_TOKEN_SECRET = 'u'.repeat(40);
  process.env.SIMPLELOGIN_API_KEY = 'test-key';
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.READ_RATE_LIMIT_MAX;
  delete process.env.READ_RATE_LIMIT_WINDOW_MS;
  return root;
}

async function freshApp() {
  vi.resetModules();
  return (await import('../src/api/index.ts')).default;
}

async function login(app: Awaited<ReturnType<typeof freshApp>>) {
  const response = await app.request('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'admin-pass' }),
  });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie') || '';
}

afterEach(() => {
  process.chdir(originalCwd);
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe('security API integration', () => {
  test('uses AliasPinStore for set, status, verify, count, and remove', async () => {
    const root = makeRoot();
    const app = await freshApp();
    const cookie = await login(app);

    const set = await app.request('/api/admin/pins/101', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ pin: '1234' }),
    });
    expect(set.status).toBe(200);
    const persisted = readFileSync(join(root, 'data', 'alias-pins.json'), 'utf8');
    expect(persisted).toMatch(/"hash":\s*"scrypt\$/);
    expect(persisted).not.toContain('1234');

    const status = await app.request('/api/sl/aliases/101/pin/status');
    await expect(status.json()).resolves.toEqual({ hasPin: true });

    const verify = await app.request('/api/sl/aliases/101/pin/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '1234', guestId: 'integration-guest' }),
    });
    expect(verify.status).toBe(200);
    expect((await verify.json() as any).unlockToken).toBeTruthy();

    const seller = await app.request('/api/seller/status', { headers: { cookie } });
    expect((await seller.json() as any).pins.protectedAliases).toBe(1);

    const remove = await app.request('/api/admin/pins/101', { method: 'DELETE', headers: { cookie } });
    expect(remove.status).toBe(200);
    const removedStatus = await app.request('/api/sl/aliases/101/pin/status');
    await expect(removedStatus.json()).resolves.toEqual({ hasPin: false });
  });

  test('fails closed without issuing an unlock token when the PIN store JSON is malformed', async () => {
    makeRoot('{"101":');
    const app = await freshApp();

    const status = await app.request('/api/sl/aliases/101/pin/status');
    await expect(status.json()).resolves.toEqual({ hasPin: true });

    const verify = await app.request('/api/sl/aliases/101/pin/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '1234', guestId: 'malformed-guest' }),
    });
    expect(verify.status).toBe(401);
    const body = await verify.json() as any;
    expect(body.matched).toBe(false);
    expect(body.unlockToken).toBeUndefined();
  });

  test('uses minimal public alias DTOs and a separate allowlisted admin DTO', async () => {
    makeRoot(JSON.stringify({ '101': { pin: '1234', updatedAt: 'legacy' } }));
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      aliases: [{
        id: 101,
        email: 'locked@example.com',
        enabled: true,
        nb_forward: 7,
        nb_block: 2,
        nb_reply: 3,
        note: 'mail-list search needs this',
        creation_date: '2026-01-01',
        pin: 'upstream-secret',
        secretField: 'must-not-leak',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;
    const app = await freshApp();

    const publicResponse = await app.request('/api/sl/aliases');
    const publicAlias = (await publicResponse.json() as any).aliases[0];
    expect(Object.keys(publicAlias).sort()).toEqual([
      'email', 'enabled', 'hasPin', 'id', 'nb_block', 'nb_forward', 'note',
    ]);
    expect(publicAlias.hasPin).toBe(true);

    const cookie = await login(app);
    const adminResponse = await app.request('/api/sl/aliases?force=1', { headers: { cookie } });
    const adminAlias = (await adminResponse.json() as any).aliases[0];
    expect(adminAlias.creation_date).toBe('2026-01-01');
    expect(adminAlias.nb_reply).toBe(3);
    expect(adminAlias.pin).toBeUndefined();
    expect(adminAlias.secretField).toBeUndefined();
  });

  test('requires admin authentication for force=1 cache bypass', async () => {
    makeRoot();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ aliases: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as any;
    const app = await freshApp();

    const denied = await app.request('/api/sl/aliases?force=1');
    expect(denied.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const cookie = await login(app);
    const allowed = await app.request('/api/sl/aliases?force=1', { headers: { cookie } });
    expect(allowed.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  test('allows only exact configured CORS origins while accepting requests without Origin', async () => {
    makeRoot();
    process.env.CORS_ALLOWED_ORIGINS = 'https://dashboard.example.test';
    const app = await freshApp();

    const defaultOrigin = await app.request('/api/ping', { headers: { origin: 'https://email-verify.one' } });
    expect(defaultOrigin.headers.get('access-control-allow-origin')).toBe('https://email-verify.one');

    const configured = await app.request('/api/ping', { headers: { origin: 'https://dashboard.example.test' } });
    expect(configured.headers.get('access-control-allow-origin')).toBe('https://dashboard.example.test');

    const lookalike = await app.request('/api/ping', { headers: { origin: 'https://email-verify.one.evil.test' } });
    expect(lookalike.headers.get('access-control-allow-origin')).toBeNull();

    const noOrigin = await app.request('/api/ping');
    expect(noOrigin.status).toBe(200);
  });

  test('rate-limits repeated public read requests and returns Retry-After', async () => {
    makeRoot();
    process.env.READ_RATE_LIMIT_MAX = '2';
    process.env.READ_RATE_LIMIT_WINDOW_MS = '60000';
    const app = await freshApp();

    expect((await app.request('/api/sl/aliases/101/pin/status')).status).toBe(200);
    expect((await app.request('/api/sl/aliases/101/pin/status')).status).toBe(200);
    const limited = await app.request('/api/sl/aliases/101/pin/status');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
