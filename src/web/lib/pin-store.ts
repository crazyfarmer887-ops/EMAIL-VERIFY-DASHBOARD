// ─── Per-Alias PIN Store ───────────────────────────────────────────────
const UNLOCK_DURATION_MS = 30 * 60 * 1000; // 30분

function pinKey(aliasId: number | string) { return `sl_alias_pin_${aliasId}`; }
function unlockKey(aliasId: number | string) { return `sl_alias_unlocked_${aliasId}`; }

export function getAliasPin(aliasId: number | string): string | null {
  return localStorage.getItem(pinKey(aliasId));
}
export function setAliasPin(aliasId: number | string, pin: string) {
  localStorage.setItem(pinKey(aliasId), pin);
}
export function removeAliasPin(aliasId: number | string) {
  localStorage.removeItem(pinKey(aliasId));
  localStorage.removeItem(unlockKey(aliasId));
}
export function isAliasUnlocked(aliasId: number | string): boolean {
  const until = localStorage.getItem(unlockKey(aliasId));
  if (!until) return false;
  return Date.now() < Number(until);
}
export function setAliasUnlocked(aliasId: number | string) {
  localStorage.setItem(unlockKey(aliasId), String(Date.now() + UNLOCK_DURATION_MS));
}
export function lockAlias(aliasId: number | string) {
  localStorage.removeItem(unlockKey(aliasId));
}

// ─── All aliases with PIN (for list UI indicator) ──────────────────────
export function getAliasesWithPin(): string[] {
  const result: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('sl_alias_pin_')) {
      result.push(k.replace('sl_alias_pin_', ''));
    }
  }
  return result;
}
