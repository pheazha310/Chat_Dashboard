import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WsClient, type WebSocketLike } from "./client";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: WebSocketLike["onopen"] = null;
  onmessage: WebSocketLike["onmessage"] = null;
  onclose: WebSocketLike["onclose"] = null;
  onerror: WebSocketLike["onerror"] = null;
  sent: string[] = [];
  send = (data: string) => void this.sent.push(data);
  close = () => {
    this.readyState = 3;
    this.onclose?.();
  };
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(frame: unknown) {
    this.onmessage?.({
      data: typeof frame === "string" ? frame : JSON.stringify(frame),
    });
  }
}

let sockets: FakeSocket[];
const makeClient = () =>
  new WsClient(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("connection lifecycle", () => {
  it("moves idle → connecting → open", () => {
    const client = makeClient();
    const statuses: string[] = [];
    client.onStatus((status) => statuses.push(status));
    client.connect();
    sockets[0].open();
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("reconnects with exponential backoff and caps the delay", () => {
    const client = makeClient();
    client.connect();
    sockets[0].close();
    expect(client.status).toBe("reconnecting");

    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    sockets[1].close();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    for (let i = 0; i < 10; i++) {
      sockets.at(-1)!.close();
      vi.advanceTimersByTime(10_000);
    }
    const count = sockets.length;
    sockets.at(-1)!.close();
    vi.advanceTimersByTime(9_999);
    expect(sockets).toHaveLength(count);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(count + 1);
  });

  it("resets the backoff once the socket opens", () => {
    const client = makeClient();
    client.connect();
    sockets[0].close();
    vi.advanceTimersByTime(500);
    sockets[1].open();
    sockets[1].close();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(3);
  });

  it("does not reconnect after disconnect()", () => {
    const client = makeClient();
    client.connect();
    client.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(client.status).toBe("idle");
  });
});

describe("incoming events", () => {
  it("delivers valid events to handlers", () => {
    const client = makeClient();
    const handler = vi.fn();
    client.on("notice", handler);
    client.connect();
    sockets[0].open();
    sockets[0].receive({ type: "notice", payload: { text: "hello" } });
    expect(handler).toHaveBeenCalledWith({ text: "hello" });
  });

  it("drops malformed frames and invalid payloads", () => {
    const client = makeClient();
    const handler = vi.fn();
    client.on("notice", handler);
    client.connect();
    sockets[0].open();
    sockets[0].receive("not json");
    sockets[0].receive({ type: "notice" });
    sockets[0].receive({ type: "notice", payload: { text: 42 } });
    sockets[0].receive({ type: "unknown", payload: {} });
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps calling other handlers when one throws", () => {
    const client = makeClient();
    const second = vi.fn();
    client.on("notice", () => {
      throw new Error("boom");
    });
    client.on("notice", second);
    client.connect();
    sockets[0].open();
    sockets[0].receive({ type: "notice", payload: { text: "hi" } });
    expect(second).toHaveBeenCalledOnce();
  });

  it("stops delivering after unsubscribe", () => {
    const client = makeClient();
    const handler = vi.fn();
    const off = client.on("notice", handler);
    client.connect();
    sockets[0].open();
    off();
    sockets[0].receive({ type: "notice", payload: { text: "hi" } });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("outgoing events", () => {
  const message = { conversationId: "a", clientId: "c1", text: "hi" };

  it("sends immediately when open", () => {
    const client = makeClient();
    client.connect();
    sockets[0].open();
    client.send("message.send", message);
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      type: "message.send",
      payload: message,
    });
  });

  it("queues message.send while offline and flushes on open", () => {
    const client = makeClient();
    client.send("message.send", message);
    client.connect();
    expect(sockets[0].sent).toHaveLength(0);
    sockets[0].open();
    expect(sockets[0].sent).toHaveLength(1);
  });

  it("does not queue other events while offline", () => {
    const client = makeClient();
    client.send("conversation.read", { conversationId: "a" });
    client.connect();
    sockets[0].open();
    expect(sockets[0].sent).toHaveLength(0);
  });

  it("drops queued messages after the TTL", () => {
    const client = makeClient();
    client.send("message.send", message);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    client.connect();
    sockets[0].open();
    expect(sockets[0].sent).toHaveLength(0);
  });

  it("keeps only the newest 100 queued messages", () => {
    const client = makeClient();
    for (let i = 0; i < 105; i++) client.send("message.send", { ...message, clientId: `c${i}` });
    client.connect();
    sockets[0].open();
    const ids = sockets[0].sent.map((frame) => JSON.parse(frame).payload.clientId);
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe("c5");
  });
});
