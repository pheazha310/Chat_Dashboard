import { isServerEvent, type ClientEventMap, type Envelope, type ServerEventMap } from "./protocol";

/** The subset of the browser WebSocket API the client relies on. */
export interface WebSocketLike {
  readyState: number;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketStatus = "idle" | "connecting" | "open" | "reconnecting";

type Handler<P> = (payload: P) => void;

const OPEN = 1;
const MAX_BACKOFF_MS = 10_000;
const MAX_QUEUED_MESSAGES = 100;
const QUEUE_TTL_MS = 5 * 60_000;

export class WsClient {
  status: SocketStatus = "idle";

  private socket: WebSocketLike | null = null;
  private handlers = new Map<string, Set<Handler<never>>>();
  private statusListeners = new Set<(status: SocketStatus) => void>();
  private queue: Array<{ frame: string; expiresAt: number }> = [];
  private attempts = 0;
  private retryTimer: number | undefined;
  private manualClose = false;

  constructor(private createSocket: () => WebSocketLike) {}

  connect() {
    if (this.socket) return;
    this.manualClose = false;
    this.setStatus(this.attempts > 0 ? "reconnecting" : "connecting");

    let socket: WebSocketLike;
    try {
      socket = this.createSocket();
    } catch (error) {
      console.warn("[ws] failed to create socket", error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.setStatus("open");
      this.flush();
    };
    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data) as unknown;
        if (
          !frame ||
          typeof frame !== "object" ||
          !("type" in frame) ||
          !("payload" in frame) ||
          typeof frame.type !== "string"
        ) {
          throw new Error("Invalid event envelope");
        }
        const { type, payload } = frame as Envelope;
        if (!isServerEvent(type, payload)) throw new Error(`Invalid payload for event: ${type}`);
        this.dispatch(type, payload);
      } catch (error) {
        console.warn("[ws] dropped malformed frame", error);
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.manualClose) return this.setStatus("idle");
      this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manualClose = true;
    window.clearTimeout(this.retryTimer);
    this.attempts = 0;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus("idle");
  }

  send<K extends keyof ClientEventMap>(type: K, payload: ClientEventMap[K]) {
    const frame = JSON.stringify({ type, payload });
    if (this.socket?.readyState === OPEN) {
      try {
        this.socket.send(frame);
        return;
      } catch (error) {
        console.warn("[ws] failed to send event", error);
        this.socket.close();
      }
    }

    // Only preserve user-authored messages while offline. Other actions can go stale.
    if (type === "message.send") {
      this.queue = this.queue.filter(({ expiresAt }) => expiresAt > Date.now());
      if (this.queue.length >= MAX_QUEUED_MESSAGES) this.queue.shift();
      this.queue.push({ frame, expiresAt: Date.now() + QUEUE_TTL_MS });
    }
  }

  on<K extends keyof ServerEventMap>(type: K, handler: Handler<ServerEventMap[K]>) {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler as Handler<never>);
    this.handlers.set(type, set);
    return () => void set.delete(handler as Handler<never>);
  }

  onStatus(listener: (status: SocketStatus) => void) {
    this.statusListeners.add(listener);
    return () => void this.statusListeners.delete(listener);
  }

  /** Run every handler for an event; one failing handler must not starve the others. */
  private dispatch(type: string, payload: unknown) {
    this.handlers.get(type)?.forEach((handler) => {
      try {
        (handler as Handler<unknown>)(payload);
      } catch (error) {
        console.warn(`[ws] handler for "${type}" threw`, error);
      }
    });
  }

  private flush() {
    const pending = this.queue;
    this.queue = [];
    for (let i = 0; i < pending.length; i++) {
      const { expiresAt, frame } = pending[i];
      if (expiresAt <= Date.now()) continue;
      const socket = this.socket;
      if (!socket || socket.readyState !== OPEN) {
        this.queue.push(...pending.slice(i).filter((item) => item.expiresAt > Date.now()));
        return;
      }
      try {
        socket.send(frame);
      } catch (error) {
        console.warn("[ws] failed to flush queued message", error);
        this.queue.push(...pending.slice(i).filter((item) => item.expiresAt > Date.now()));
        socket.close();
        return;
      }
    }
  }

  private scheduleReconnect() {
    this.attempts += 1;
    this.setStatus("reconnecting");
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** (this.attempts - 1));
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: SocketStatus) {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}
