const rawBase = (import.meta.env.VITE_BASE_PATH || import.meta.env.APP_BASE_PATH || "/email/") as string;

function normalizeBase(base: string) {
  if (!base || base === "/") return "/";
  const withLeading = base.startsWith("/") ? base : `/${base}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

export const BASE_PATH = normalizeBase(rawBase);
export const ROUTER_BASE = BASE_PATH === "/" ? "" : BASE_PATH.slice(0, -1);

export function apiPath(path: string) {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}api${clean}`;
}
