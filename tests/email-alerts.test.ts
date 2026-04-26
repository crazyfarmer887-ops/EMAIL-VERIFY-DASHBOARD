import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tmp = mkdtempSync(join(tmpdir(), 'email-alerts-'));
process.chdir(tmp);

type FetchCall = { url: string; body: any };
const calls: FetchCall[] = [];

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  calls.push({
    url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    body: init?.body ? JSON.parse(String(init.body)) : null,
  });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const alerts = await import('../src/api/alerts/telegram.ts');

function resetAlertEnv() {
  delete process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN;
  delete process.env.SELLER_ALERT_TELEGRAM_CHAT_ID;
  calls.length = 0;
  rmSync(join(tmp, 'data', 'alert-state.json'), { force: true });
}

test('telegram alerts are disabled without env and do not call fetch', async () => {
  resetAlertEnv();
  const result = await alerts.sendTelegramAlert({
    key: 'disabled-test',
    title: 'Disabled',
    message: 'No env should skip network',
  });
  assert.deepEqual(result, { ok: true, status: 'disabled' });
  assert.equal(calls.length, 0);
  assert.equal(existsSync(join(tmp, 'data', 'alert-state.json')), false);
});

test('telegram alerts throttle the same key for 30 minutes by default', async () => {
  resetAlertEnv();
  process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN = 'unit-test-bot-token';
  process.env.SELLER_ALERT_TELEGRAM_CHAT_ID = '12345';

  const first = await alerts.sendTelegramAlert({ key: 'same-key', title: 'One', message: 'first', now: 1_000 });
  const second = await alerts.sendTelegramAlert({ key: 'same-key', title: 'Two', message: 'second', now: 1_000 + 29 * 60 * 1000 });
  const third = await alerts.sendTelegramAlert({ key: 'same-key', title: 'Three', message: 'third', now: 1_000 + 31 * 60 * 1000 });

  assert.equal(first.status, 'sent');
  assert.equal(second.status, 'throttled');
  assert.equal(third.status, 'sent');
  assert.equal(calls.length, 2);
});

test('telegram alert formatter redacts sensitive values', () => {
  const text = alerts.formatTelegramAlert({
    key: 'redaction-test',
    title: 'Redaction',
    message: 'Authorization: Bearer abc.def.ghi Cookie: sid=secret',
    details: {
      token: 'plain-token',
      refresh_token: 'refresh-secret',
      access_token: 'access-secret',
      client_secret: 'client-secret',
      password: 'pw-secret',
      nested: {
        Authorization: 'Bearer nested-secret',
        safe: 'visible',
      },
      raw: 'access_token=abc123 refresh_token=def456 password=hunter2',
    },
  });

  assert.match(text, /\[REDACTED\]/);
  assert.match(text, /visible/);
  assert.equal(text.includes('plain-token'), false);
  assert.equal(text.includes('refresh-secret'), false);
  assert.equal(text.includes('access-secret'), false);
  assert.equal(text.includes('client-secret'), false);
  assert.equal(text.includes('pw-secret'), false);
  assert.equal(text.includes('abc.def.ghi'), false);
  assert.equal(text.includes('sid=secret'), false);
  assert.equal(text.includes('hunter2'), false);
});

test('invalid_grant formatter uses actionable Gmail reauth wording and redacts details', () => {
  const text = alerts.formatGmailInvalidGrantAlert(new Error('invalid_grant refresh_token=secret-token'));
  assert.match(text, /Gmail 동기화 재인증 필요/);
  assert.match(text, /invalid_grant/);
  assert.match(text, /재인증/);
  assert.equal(text.includes('secret-token'), false);
});
