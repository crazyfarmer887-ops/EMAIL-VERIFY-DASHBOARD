export const GMAIL_SYNC_BASE_POLL_INTERVAL_MS = 15_000;
export const GMAIL_SYNC_MAX_BACKOFF_MS = 15 * 60_000;

export function isPermanentOAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid_grant/i.test(message);
}

export function formatGmailSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid_grant/i.test(message)) {
    return 'OAuth refresh token invalid_grant (재인증 필요)';
  }
  return message;
}

export function nextGmailSyncDelayMs(consecutiveErrors: number, error: unknown): number {
  if (isPermanentOAuthError(error)) return GMAIL_SYNC_MAX_BACKOFF_MS;
  const attempts = Math.max(0, consecutiveErrors - 1);
  const delay = GMAIL_SYNC_BASE_POLL_INTERVAL_MS * (2 ** attempts);
  return Math.min(delay, GMAIL_SYNC_MAX_BACKOFF_MS);
}
