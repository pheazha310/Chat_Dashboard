import { useSessionStore } from "@/shared/api/session";
import type { WebSocketLike } from "../client";
import { BackendTranslator } from "./translator";

type SocketLike = {
  readyState: number;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  send(data: string): void;
  close(): void;
};
export type SocketConstructor = new (url: string) => SocketLike;

const OPEN = 1;
const CLOSED = 3;
/** Close codes the gateway uses for "not signed in" / "not allowed". Retrying with the same token is pointless. */
const AUTH_CLOSE_CODES = new Set([4401, 4403]);

let everAuthenticated = false;
let rejectedToken: string | undefined;

/** Test hook: forget what earlier sockets learned. */
export const resetBackendSocketState = () => {
  everAuthenticated = false;
  rejectedToken = undefined;
};

/**
 * The real transport, shaped like a WebSocket so `WsClient` (reconnect, queueing, validation) works unchanged.
 * It reports `open` only after the gateway has authenticated the token, so messages queued while offline flush
 * once the connection is usable, and it translates events in both directions (see `BackendTranslator`).
 */
export class BackendSocket implements WebSocketLike {
  readyState = 0;
  onopen: WebSocketLike["onopen"] = null;
  onmessage: WebSocketLike["onmessage"] = null;
  onclose: WebSocketLike["onclose"] = null;
  onerror: WebSocketLike["onerror"] = null;

  private readonly translator = new BackendTranslator();
  private socket: SocketLike | undefined;
  private authenticated = false;

  constructor(
    url: string,
    getToken: () => string | undefined,
    Impl: SocketConstructor = WebSocket as unknown as SocketConstructor,
  ) {
    const token = getToken();
    if (!token || token === rejectedToken) {
      console.warn(token ? "[ws] the access token was rejected" : "[ws] no access token configured (VITE_AUTH_TOKEN)");
      // WsClient installs its handlers right after construction, so fail on the next tick.
      setTimeout(() => this.fail(), 0);
      return;
    }

    const socket = new Impl(url);
    this.socket = socket;
    socket.onmessage = (event) => this.receive(event.data, token);
    socket.onerror = (event) => this.onerror?.(event);
    socket.onclose = (event) => {
      if (event.code !== undefined && AUTH_CLOSE_CODES.has(event.code)) rejectedToken = token;
      this.finish();
    };
  }

  send(data: string) {
    if (!this.authenticated || !this.socket) return;
    const { type, payload } = JSON.parse(data) as { type: string; payload: unknown };
    const { send, reply } = this.translator.toBackend(type, payload);
    for (const frame of send) this.socket.send(JSON.stringify(frame));
    for (const frame of reply) setTimeout(() => this.deliver(frame), 0);
  }

  close() {
    if (this.readyState === CLOSED) return;
    if (this.socket) this.socket.close();
    else this.finish();
  }

  private receive(raw: string, token: string) {
    let frame: { type: string; payload: Record<string, unknown> };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof frame?.type !== "string" || typeof frame.payload !== "object" || frame.payload === null) return;

    switch (frame.type) {
      case "connection.established":
        this.socket?.send(JSON.stringify({ type: "auth", payload: { token, reconnect: everAuthenticated } }));
        return;
      case "connection.authenticated":
      case "connection.reconnected": {
        const userId = String(frame.payload.userId);
        this.translator.userId = userId;
        useSessionStore.getState().set({ userId, role: String(frame.payload.role) });
        everAuthenticated = true;
        this.authenticated = true;
        this.readyState = OPEN;
        this.onopen?.();
        return;
      }
    }
    for (const out of this.translator.fromBackend(frame)) this.deliver(out);
  }

  private deliver(frame: { type: string; payload: unknown }) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  private fail() {
    this.onerror?.();
    this.finish();
  }

  private finish() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.authenticated = false;
    useSessionStore.getState().set({ userId: null, role: null });
    this.onclose?.();
  }
}
