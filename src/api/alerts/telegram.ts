import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const DEFAULT_ALERT_THROTTLE_MS = 30 * 60 * 1000;
export const ALERT_STATE_PATH = resolve(process.cwd(), 'data', 'alert-state.json');

type AlertState = Record<string, { lastSentAt: number }>;

export type TelegramAlertInput = {
  key: string;
  title: string;
  message: string;
  details?: Record<string, unknown>;
  throttleMs?: number;
  now?: number;
};

export type TelegramAlertResult =
  | { ok: true; status: 'sent' }
  | { ok: true; status: 'disabled' }
  | { ok: true; status: 'throttled' }
  | { ok: false; status: 'error'; error: string };

function readState(path = ALERT_STATE_PATH): AlertState {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AlertState : {};
  } catch {
    return {};
  }
}

function writeState(state: AlertState, path = ALERT_STATE_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

export function isTelegramAlertEnabled(env = process.env) {
  return Boolean(env.SELLER_ALERT_TELEGRAM_BOT_TOKEN && env.SELLER_ALERT_TELEGRAM_CHAT_ID);
}

export function shouldSendAlert(key: string, now = Date.now(), throttleMs = DEFAULT_ALERT_THROTTLE_MS, path = ALERT_STATE_PATH) {
  const state = readState(path);
  const lastSentAt = Number(state[key]?.lastSentAt || 0);
  return !lastSentAt || now - lastSentAt >= throttleMs;
}

function markAlertSent(key: string, now = Date.now(), path = ALERT_STATE_PATH) {
  const state = readState(path);
  state[key] = { lastSentAt: now };
  writeState(state, path);
}

const SENSITIVE_KEY_RE = /(^|[_-])(token|access[_-]?token|refresh[_-]?token|secret|password|passwd|pwd|authorization|cookie|set-cookie|api[_-]?key|client[_-]?secret)($|[_-])/i;
const AUTH_BEARER_RE = /\b(Authorization\s*[:=]\s*Bearer\s+)[^\s,;]+/gi;
const COOKIE_RE = /\b(Cookie|Set-Cookie)\s*[:=]\s*[^\n\r]+/gi;
const TOKEN_PAIR_RE = /\b(access_token|refresh_token|token|secret|password|client_secret|api_key)\s*[:=]\s*[^\s,;&)]+/gi;

export function redactSensitive(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input === 'string') {
    return input
      .replace(AUTH_BEARER_RE, '$1[REDACTED]')
      .replace(COOKIE_RE, '$1: [REDACTED]')
      .replace(TOKEN_PAIR_RE, '$1=[REDACTED]');
  }
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (input instanceof Error) return redactSensitive(input.message);
  if (Array.isArray(input)) return input.map(item => redactSensitive(item));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : redactSensitive(value);
    }
    return out;
  }
  return String(input);
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatTelegramAlert(input: TelegramAlertInput) {
  const redactedTitle = String(redactSensitive(input.title));
  const redactedMessage = String(redactSensitive(input.message));
  const redactedDetails = redactSensitive(input.details || {}) as Record<string, unknown>;
  const lines = [`🚨 ${redactedTitle}`, '', redactedMessage];
  const entries = Object.entries(redactedDetails);
  if (entries.length) {
    lines.push('', ...entries.map(([key, value]) => `• ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`));
  }
  return escapeHtml(lines.join('\n'));
}

export function formatGmailInvalidGrantAlert(error: unknown) {
  return formatTelegramAlert({
    key: 'gmail-sync:invalid_grant',
    title: 'Gmail 동기화 재인증 필요',
    message: 'Gmail OAuth refresh token이 invalid_grant로 거부되었습니다. Gmail 재인증이 필요합니다.',
    details: { error },
  });
}

export async function sendTelegramAlert(input: TelegramAlertInput): Promise<TelegramAlertResult> {
  const token = process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.SELLER_ALERT_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: true, status: 'disabled' };

  const now = input.now ?? Date.now();
  const throttleMs = input.throttleMs ?? DEFAULT_ALERT_THROTTLE_MS;
  if (!shouldSendAlert(input.key, now, throttleMs)) return { ok: true, status: 'throttled' };

  const text = formatTelegramAlert(input);
  try {
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) return { ok: false, status: 'error', error: `telegram_send_failed_${res.status}` };
    markAlertSent(input.key, now);
    return { ok: true, status: 'sent' };
  } catch (error) {
    return { ok: false, status: 'error', error: String(redactSensitive(error)) };
  }
}
