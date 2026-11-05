/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Real WebSocket endpoint, e.g. ws://localhost:4000/ws. When unset, the in-browser mock server is used. */
  readonly VITE_WS_URL?: string;
  /** REST base URL, e.g. http://localhost:4000/api. Defaults to the WebSocket URL's host with the /api path. */
  readonly VITE_API_URL?: string;
  /** Development access token (Backend 1 token). In production the host app stores it in localStorage "auth.token". */
  readonly VITE_AUTH_TOKEN?: string;
}
