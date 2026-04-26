import { apiPath } from '../lib/path';
// ─── Guest ID (쿠키 기반) ──────────────────────────────────────
export function getGuestId(): string {
  const KEY = 'sl_guest_id';
  const existing = document.cookie.split('; ').find(r => r.startsWith(KEY + '='))?.split('=')[1];
  if (existing) return existing;
  // 새 ID 생성 (alphanumeric only - ':' 문자 없도록)
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const id = Array.from(arr).map(b => b.toString(36).padStart(2,'0')).join('').slice(0, 24);
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${KEY}=${id}; expires=${expires}; path=/; SameSite=Lax`;
  return id;
}

// ─── 서버 발급 Unlock 토큰 저장소 ─────────────────────────────
// 키: sl_unlock_{guestId}_{aliasId}  (guestId 포함으로 브라우저별 분리)
function tokenKey(aliasId: number | string) {
  return `sl_unlock_${getGuestId()}_${aliasId}`;
}

export function getUnlockToken(aliasId: number | string): string | null {
  return localStorage.getItem(tokenKey(aliasId));
}

export function getEmailAccessHeaders(aliasId: number | string): HeadersInit {
  const token = getUnlockToken(aliasId);
  return {
    'x-sl-alias-id': String(aliasId),
    'x-sl-guest-id': getGuestId(),
    ...(token ? { 'x-sl-unlock-token': token } : {}),
  };
}

export function setUnlockToken(aliasId: number | string, token: string) {
  localStorage.setItem(tokenKey(aliasId), token);
}

export function lockAlias(aliasId: number | string) {
  localStorage.removeItem(tokenKey(aliasId));
}

// 서버에 토큰 유효성 확인 (비동기) - 만료 시 자동 정리
export async function isAliasUnlocked(aliasId: number | string): Promise<boolean> {
  const token = getUnlockToken(aliasId);
  if (!token) return false;
  try {
    const res = await fetch(apiPath(`/sl/aliases/${aliasId}/pin/check`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unlockToken: token, guestId: getGuestId() }),
    });
    const data = await res.json() as any;
    if (!data.valid) lockAlias(aliasId);
    return !!data.valid;
  } catch {
    // 네트워크 오류 시 보수적으로 잠금 유지
    return false;
  }
}

export function setAliasUnlocked(aliasId: number | string, token: string) {
  setUnlockToken(aliasId, token);
}

export function clearAliasUnlock(aliasId: number | string) {
  lockAlias(aliasId);
}
