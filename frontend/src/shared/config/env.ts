/**
 * Where the real backend lives. With no `VITE_WS_URL` the app runs against the in-browser mock server.
 * The REST URL is derived from the WebSocket URL (ws://host:4000/ws -> http://host:4000/api/v1/admin) unless set explicitly.
 */
export const WS_URL: string | undefined = import.meta.env.VITE_WS_URL || undefined;

export function deriveApiUrl(wsUrl: string | undefined): string | undefined {
  if (!wsUrl) return undefined;
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/api/v1/admin";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export const API_URL: string | undefined = (import.meta.env.VITE_API_URL || deriveApiUrl(WS_URL))?.replace(/\/$/, "");

/** Where the signed-in session (access + refresh token and the user) is kept; written by `shared/api/auth`. */
export const AUTH_SESSION_KEY = "auth.session";
/** Older key a host application could set with a bare access token. */
const LEGACY_TOKEN_KEY = "auth.token";

/** A fixed development token (`VITE_AUTH_TOKEN`). When set, the sign-in screen is skipped. */
export const DEV_AUTH_TOKEN: string | undefined = import.meta.env.VITE_AUTH_TOKEN || undefined;

/**
 * The access token for REST and the WebSocket: `VITE_AUTH_TOKEN` (development), else the signed-in session's token
 * (kept fresh by `shared/api/auth`), else `localStorage["auth.token"]`.
 */
export function getAuthToken(): string | undefined {
  if (DEV_AUTH_TOKEN) return DEV_AUTH_TOKEN;
  try {
    const stored = globalThis.localStorage?.getItem(AUTH_SESSION_KEY);
    if (stored) {
      const token = (JSON.parse(stored) as { accessToken?: unknown }).accessToken;
      if (typeof token === "string" && token) return token;
    }
    return globalThis.localStorage?.getItem(LEGACY_TOKEN_KEY) || undefined;
  } catch {
    return undefined;
  }
}
