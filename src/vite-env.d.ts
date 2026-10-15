/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Real WebSocket endpoint. When unset, the in-browser mock server is used. */
  readonly VITE_WS_URL?: string;
}
