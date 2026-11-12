/**
 * Sign-in when the dashboard runs inside an iframe in LOS Web. PROPOSED message protocol (agree it with the LOS Web
 * team; LOS has not defined one):
 *   iframe -> LOS Web  { type: "TOKEN_REQUEST" }
 *   LOS Web -> iframe  { type: "HANDOFF_TOKEN", token }   (a staff hand-off token from LOS, never put in a URL)
 * Only a message from the exact LOS Web origin AND from the parent window is accepted; everything else is ignored. The
 * token goes to the backend (`POST /auth/los`), which verifies it and issues this app's own session; it is not stored.
 */

const MAX_TOKEN_LENGTH = 4096;

type Listener = (event: MessageEvent) => void;

export interface HandoffOptions {
  /** The exact origin of LOS Web (`VITE_LOS_WEB_ORIGIN`). */
  parentOrigin: string;
  /** The window that embeds this app (`window.parent`). */
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  target: {
    addEventListener(type: "message", listener: Listener): void;
    removeEventListener(type: "message", listener: Listener): void;
  };
  /** Sends the token to the backend and starts the session. */
  exchange(token: string): Promise<unknown>;
}

/** Listens for the hand-off token, asks for one, and returns a teardown function. */
export function listenForHandoff({ parentOrigin, parent, target, exchange }: HandoffOptions): () => void {
  let exchanging = false;

  const onMessage: Listener = (event) => {
    if (event.origin !== parentOrigin || event.source !== parent) return;
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const { type, token } = data as { type?: unknown; token?: unknown };
    if (type !== "HANDOFF_TOKEN" || typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) return;
    if (exchanging) return;
    exchanging = true;
    exchange(token)
      .catch((error: unknown) => {
        // The error is logged, never the token.
        console.error("LOS hand-off sign-in failed", error instanceof Error ? error.message : "unknown error");
      })
      .finally(() => {
        exchanging = false;
      });
  };

  target.addEventListener("message", onMessage);
  parent.postMessage({ type: "TOKEN_REQUEST" }, parentOrigin);
  return () => target.removeEventListener("message", onMessage);
}
