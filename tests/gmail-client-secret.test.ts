import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GMAIL_CLIENT_SECRET_PATH,
  loadGmailClientSecret,
  resolveGmailClientSecretPath,
} from '../src/api/email/gmail-client-secret.ts';

test('uses GMAIL_CLIENT_SECRET_PATH when configured', () => {
  assert.equal(
    resolveGmailClientSecretPath({ GMAIL_CLIENT_SECRET_PATH: '/etc/graytag-email-dashboard/gmail-client-secret.json' }),
    '/etc/graytag-email-dashboard/gmail-client-secret.json',
  );
});

test('keeps the legacy client secret path as the default', () => {
  assert.equal(resolveGmailClientSecretPath({}), DEFAULT_GMAIL_CLIENT_SECRET_PATH);
});

test('treats an empty GMAIL_CLIENT_SECRET_PATH as unset', () => {
  assert.equal(resolveGmailClientSecretPath({ GMAIL_CLIENT_SECRET_PATH: '   ' }), DEFAULT_GMAIL_CLIENT_SECRET_PATH);
});

test('reports an unreadable client secret without exposing its sensitive path', () => {
  const sensitivePath = '/private/customer-name/oauth-secret-marker.json';
  assert.throws(
    () => loadGmailClientSecret(sensitivePath),
    (error: unknown) => {
      if (!(error instanceof Error)) return false;
      assert.match(error.message, /GMAIL_CLIENT_SECRET_PATH.*권한/);
      assert.doesNotMatch(error.message, /customer-name|oauth-secret-marker/);
      return true;
    },
  );
});
