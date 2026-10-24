import type { WebSocketLike } from "../client";
import type { Envelope, ServerEventMap } from "../protocol";
import { MockLendingServer, type MockConnection } from "./server";

export const mockServer = new MockLendingServer();
const liveSockets = new Set<MockSocket>();

const OPEN = 1;
const CLOSED = 3;

/** A WebSocket look-alike that talks to the in-browser mock server. */
export class MockSocket implements WebSocketLike, MockConnection {
  readyState = 0;
  onopen: WebSocketLike["onopen"] = null;
  onmessage: WebSocketLike["onmessage"] = null;
  onclose: WebSocketLike["onclose"] = null;
  onerror: WebSocketLike["onerror"] = null;

  constructor() {
    window.setTimeout(() => {
      if (this.readyState === CLOSED) return;
      this.readyState = OPEN;
      liveSockets.add(this);
      mockServer.attach(this);
      this.onopen?.();
    }, 250);
  }

  send(data: string) {
    window.setTimeout(() => this.readyState === OPEN && mockServer.receive(JSON.parse(data) as Envelope), 80);
  }

  push<K extends keyof ServerEventMap>(type: K, payload: ServerEventMap[K]) {
    if (this.readyState !== OPEN) return;
    window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type, payload }) }), 40);
  }

  close() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    liveSockets.delete(this);
    mockServer.detach(this);
    window.setTimeout(() => this.onclose?.(), 0);
  }
}

/** Demo helper: severs every mock connection so the client's reconnect path can be seen. */
export const dropMockConnections = () => [...liveSockets].forEach((socket) => socket.close());
