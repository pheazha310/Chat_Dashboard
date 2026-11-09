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

const TOKEN_KEY = "auth.token";

/**
 * The access token issued by Backend 1. The sign-in flow belongs to Backend 1's app, so for now the token comes from
 * `VITE_AUTH_TOKEN` (development) or `localStorage["auth.token"]`, which the host application can set after login.
 */
export function getAuthToken(): string | undefined {
  const fromEnv = import.meta.env.VITE_AUTH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return globalThis.localStorage?.getItem(TOKEN_KEY) || undefined;
  } catch {
    return undefined;
  }
}
