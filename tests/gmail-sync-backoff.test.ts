import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GMAIL_SYNC_BASE_POLL_INTERVAL_MS,
  GMAIL_SYNC_MAX_BACKOFF_MS,
  formatGmailSyncError,
  isPermanentOAuthError,
  nextGmailSyncDelayMs,
} from '../src/api/email/gmail-sync-backoff.ts';

test('gmail sync treats invalid_grant as a permanent OAuth error without leaking token response JSON', () => {
  const err = new Error('토큰 갱신 실패: {"error":"invalid_grant","error_description":"Bad Request"}');

  assert.equal(isPermanentOAuthError(err), true);
  assert.equal(formatGmailSyncError(err), 'OAuth refresh token invalid_grant (재인증 필요)');
  assert.equal(nextGmailSyncDelayMs(1, err), GMAIL_SYNC_MAX_BACKOFF_MS);
});

test('gmail sync exponentially backs off transient failures up to the cap', () => {
  const err = new Error('network timeout');

  assert.equal(nextGmailSyncDelayMs(1, err), GMAIL_SYNC_BASE_POLL_INTERVAL_MS);
  assert.equal(nextGmailSyncDelayMs(2, err), GMAIL_SYNC_BASE_POLL_INTERVAL_MS * 2);
  assert.equal(nextGmailSyncDelayMs(100, err), GMAIL_SYNC_MAX_BACKOFF_MS);
  assert.equal(formatGmailSyncError(err), 'network timeout');
});
