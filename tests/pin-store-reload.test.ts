import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const originalEnv = { ...process.env };
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('email alias PIN store reload', () => {
  test('picks up PIN file changes written by the OTT dashboard without restarting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'email-pin-reload-'));
    process.chdir(dir);
    process.env.ADMIN_PASSWORD = 'admin-pass';
    process.env.ADMIN_SESSION_SECRET = 'x'.repeat(40);
    process.env.UNLOCK_TOKEN_SECRET = 'y'.repeat(40);
    writeFileSync(join(dir, '.env'), 'SIMPLELOGIN_API_KEY=test\n');

    vi.resetModules();
    const { default: app } = await import('../src/api/index.ts');

    const login = await app.fetch(new Request('http://local/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'admin-pass' }),
    }));
    const cookie = login.headers.get('set-cookie') || '';
    expect(login.status).toBe(200);

    const firstSave = await app.fetch(new Request('http://local/api/admin/pins/101', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ pin: '1111' }),
    }));
    expect(firstSave.status).toBe(200);

    writeFileSync(join(dir, 'data', 'alias-pins.json'), JSON.stringify({ '101': { pin: '2222', updatedAt: '2026-05-03T00:00:00.000Z' } }));

    const verify = await app.fetch(new Request('http://local/api/sl/aliases/101/pin/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '2222', guestId: 'guest-1' }),
    }));
    const body = await verify.json() as any;

    expect(verify.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
