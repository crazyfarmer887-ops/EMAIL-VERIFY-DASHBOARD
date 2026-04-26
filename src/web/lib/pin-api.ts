import { apiPath } from "./path";

export async function verifyAliasPin(aliasId: number, pin: string, guestId: string) {
  const res = await fetch(apiPath(`/sl/aliases/${aliasId}/pin/verify`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin, guestId }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !!data.ok, data };
}

export async function getAdminSession() {
  const res = await fetch(apiPath("/admin/session"), { credentials: "include" });
  return res.json().catch(() => ({ authenticated: false, configured: false }));
}

export async function getSellerStatus() {
  const res = await fetch(apiPath("/seller/status"), { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "상태 조회 실패");
  return data;
}

export async function loginAdmin(password: string) {
  const res = await fetch(apiPath("/admin/login"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function logoutAdmin() {
  const res = await fetch(apiPath("/admin/logout"), { method: "POST", credentials: "include" });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function saveAliasPin(aliasId: number, pin: string) {
  const res = await fetch(apiPath(`/admin/pins/${aliasId}`), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function deleteAliasPin(aliasId: number) {
  const res = await fetch(apiPath(`/admin/pins/${aliasId}`), { method: "DELETE", credentials: "include" });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}
