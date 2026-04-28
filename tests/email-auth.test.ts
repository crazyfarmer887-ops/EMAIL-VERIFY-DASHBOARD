import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tmp = mkdtempSync(join(tmpdir(), 'email-auth-'));
mkdirSync(join(tmp, 'data'), { recursive: true });
writeFileSync(
  join(tmp, 'data', 'alias-pins.json'),
  JSON.stringify({ '101': { pin: '1234', updatedAt: new Date().toISOString() } }),
);
process.chdir(tmp);
process.env.ADMIN_PASSWORD='test-admin-password-not-a-real-secret';
process.env.ADMIN_SESSION_SECRET='test-admin-session-secret-32-bytes-minimum';
process.env.UNLOCK_TOKEN_SECRET='test-unlock-token-secret-32-bytes-minimum';
process.env.SIMPLELOGIN_API_KEY = 'test-sl-key';

globalThis.fetch = async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes('/aliases?page_id=')) {
    return new Response(JSON.stringify({ aliases: [{ id: 101, email: 'locked@example.com', pin: '1234' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (url.endsWith('/aliases/101')) {
    return new Response(JSON.stringify({ id: 101, email: 'locked@example.com' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
};

const { pool } = await import('../src/api/email/email-store.ts');
const app = (await import('../src/api/index.ts')).default;

const row = {
  uid: 555,
  alias_to: 'locked@example.com',
  from_addr: 'sender@example.net',
  original_from: 'origin@example.net',
  subject: 'secret subject',
  html: '<p>secret</p>',
  text_body: 'secret',
  date_str: 'Mon, 1 Jan 2024 00:00:00 +0000',
  timestamp_sec: 1704067200,
  fetched_at: Date.now(),
};

let queries = 0;
(pool as any).query = async (sql: string, params: unknown[]) => {
  queries++;
  if (String(sql).includes('WHERE uid = $1')) return { rows: [row], rowCount: 1 };
  return { rows: [row], rowCount: 1 };
};

async function loginAsAdmin() {
  const login = await app.request('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie') || '';
  assert.match(cookie, /graytag_admin_session=/);
  return cookie;
}

test('seller status is admin-only and returns a safe dashboard status shape', async () => {
  const publicRes = await app.request('/api/seller/status');
  assert.equal(publicRes.status, 401);

  const cookie = await loginAsAdmin();
  const res = await app.request('/api/seller/status', { headers: { cookie } });
  assert.equal(res.status, 200);
  const data = await res.json() as any;
  assert.equal(data.ok, false, 'top-level ok must reflect gmail/warnings state');
  assert.match(data.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(data.gmail.ok, false);
  assert.equal(data.gmail.lastSync, null);
  assert.equal(data.gmail.historyId, null);
  assert.equal(typeof data.gmail.lastError === 'string' || data.gmail.lastError === null, true);
  assert.equal(data.pins.protectedAliases, 1);
  assert.equal(data.email.lastReceivedAt, '2024-01-01T00:00:00.000Z');
  assert.ok(Array.isArray(data.warnings));
  assert.ok(data.warnings.length > 0);
  assert.equal(JSON.stringify(data).includes('1234'), false, 'must not leak PIN values');
});

test('admin alias list exposes hasPin without returning PIN plaintext', async () => {
  const cookie = await loginAsAdmin();
  const res = await app.request('/api/sl/aliases', { headers: { cookie } });
  assert.equal(res.status, 200);
  const data = await res.json() as any;
  assert.equal(data.aliases[0].hasPin, true);
  assert.equal(Object.hasOwn(data.aliases[0], 'pin'), false);
  assert.equal(JSON.stringify(data).includes('1234'), false, 'must not leak PIN values');
});

test('email list for a PIN-protected alias is rejected without server-side unlock/admin', async () => {
  queries = 0;
  const res = await app.request('/api/email/list?alias=locked%40example.com&limit=10', { headers: { 'x-sl-alias-id': '101' } });
  assert.equal(res.status, 403);
  assert.equal(queries, 0, 'must reject before querying email contents');
});

test('email list accepts an admin session without alias PIN headers', async () => {
  const cookie = await loginAsAdmin();
  queries = 0;
  const res = await app.request('/api/email/list?alias=locked%40example.com&limit=10', { headers: { cookie } });
  assert.equal(res.status, 200);
  const data = await res.json() as any;
  assert.equal(data.emails[0].uid, 555);
  assert.equal(queries > 0, true);
});

test('email uid detail accepts an admin session without alias PIN headers', async () => {
  const cookie = await loginAsAdmin();
  const res = await app.request('/api/email/uid/555', { headers: { cookie } });
  assert.equal(res.status, 200);
  const data = await res.json() as any;
  assert.equal(data.aliasTo, 'locked@example.com');
});

test('email list accepts a valid alias-scoped unlock token', async () => {
  const verify = await app.request('/api/sl/aliases/101/pin/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '1234', guestId: 'guest-a' }),
  });
  assert.equal(verify.status, 200);
  const { unlockToken } = await verify.json() as any;

  const res = await app.request('/api/email/list?alias=locked%40example.com&limit=10', {
    headers: {
      'x-sl-alias-id': '101',
      'x-sl-guest-id': 'guest-a',
      'x-sl-unlock-token': unlockToken,
    },
  });
  assert.equal(res.status, 200);
  const data = await res.json() as any;
  assert.equal(data.emails[0].uid, 555);
});

test('email uid detail is rejected after DB lookup when row alias is still locked', async () => {
  const res = await app.request('/api/email/uid/555', { headers: { 'x-sl-alias-id': '101' } });
  assert.equal(res.status, 403);
});

test('email subjects and raw endpoints also require alias unlock/admin', async () => {
  const subjects = await app.request('/api/email/subjects?alias=locked%40example.com', { headers: { 'x-sl-alias-id': '101' } });
  assert.equal(subjects.status, 403);

  const raw = await app.request('/api/email/raw?alias=locked%40example.com&ts=1704067200', { headers: { 'x-sl-alias-id': '101' } });
  assert.equal(raw.status, 403);
});

test('email uid detail accepts a valid unlock token for the row alias', async () => {
  const verify = await app.request('/api/sl/aliases/101/pin/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '1234', guestId: 'guest-b' }),
  });
  assert.equal(verify.status, 200);
  const { unlockToken } = await verify.json() as any;

  const res = await app.request('/api/email/uid/555', {
    headers: {
      'x-sl-alias-id': '101',
      'x-sl-guest-id': 'guest-b',
      'x-sl-unlock-token': unlockToken,
    },
  });
  assert.equal(res.status, 200);
  const data = await res.json() as any;
  assert.equal(data.aliasTo, 'locked@example.com');
});

test('admin login cookie uses a short-lived httpOnly session and secure flag on https', async () => {
  const res = await app.request('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie') || '';
  assert.match(cookie, /graytag_admin_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);
  assert.match(cookie, /Secure/i);
  const maxAge = Number(cookie.match(/Max-Age=(\d+)/i)?.[1]);
  assert.equal(maxAge, 24 * 60 * 60);
});

test('PIN verify rate-limits repeated failures by alias globally without trusting XFF', async () => {
  for (let i = 0; i < 5; i++) {
    const res = await app.request('/api/sl/aliases/101/pin/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.10',
      },
      body: JSON.stringify({ pin: '0000', guestId: 'brute-guest' }),
    });
    assert.equal(res.status, 401);
  }

  const locked = await app.request('/api/sl/aliases/101/pin/verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
    },
    body: JSON.stringify({ pin: '1234', guestId: 'brute-guest' }),
  });
  assert.equal(locked.status, 429);
  const data = await locked.json() as any;
  assert.equal(data.ok, false);
  assert.equal(data.locked, true);

  const differentGuest = await app.request('/api/sl/aliases/101/pin/verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
    },
    body: JSON.stringify({ pin: '1234', guestId: 'brute-guest-2' }),
  });
  assert.equal(differentGuest.status, 429);
});
