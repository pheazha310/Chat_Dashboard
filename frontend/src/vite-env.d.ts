/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Real WebSocket endpoint, e.g. ws://localhost:4000/ws. When unset, the in-browser mock server is used. */
  readonly VITE_WS_URL?: string;
  /** REST base URL, e.g. http://localhost:4000/api/v1/admin. Defaults to the WebSocket URL's host with the /api/v1/admin path. */
  readonly VITE_API_URL?: string;
  /** Development access token (e.g. `dev:<uuid>:AGENT` with backend AUTH_MODE=dev). When set, the sign-in screen is skipped. */
  readonly VITE_AUTH_TOKEN?: string;
}
