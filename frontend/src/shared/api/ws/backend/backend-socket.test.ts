import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/shared/api/session";
import { BackendSocket, resetBackendSocketState, type SocketConstructor } from "./backend-socket";

class FakeWs {
  static instances: FakeWs[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: { type: string; payload: Record<string, unknown> }[] = [];
  closed = false;
  constructor(readonly url: string) {
    FakeWs.instances.push(this);
  }
  send = (data: string) => void this.sent.push(JSON.parse(data));
  close = () => {
    this.closed = true;
    this.onclose?.({ code: 1000 });
  };
  server(type: string, payload: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type, payload }) });
  }
}

const Impl = FakeWs as unknown as SocketConstructor;
const last = () => FakeWs.instances.at(-1)!;

function connect(token: string | null = "dev:3:AGENT") {
  const socket = new BackendSocket("ws://localhost:4000/ws", () => token ?? undefined, Impl);
  const received: { type: string; payload: unknown }[] = [];
  const opened = vi.fn();
  const closed = vi.fn();
  socket.onopen = opened;
  socket.onclose = closed;
  socket.onmessage = ({ data }) => received.push(JSON.parse(data));
  return { socket, received, opened, closed };
}

beforeEach(() => {
  FakeWs.instances = [];
  resetBackendSocketState();
  useSessionStore.setState({ userId: null, role: null });
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("BackendSocket handshake", () => {
  it("authenticates with the token and reports open only once the server accepted it", () => {
    const { socket, opened } = connect();
    expect(socket.readyState).toBe(0);
    last().server("connection.established", { connectionId: "x", authTimeoutMs: 10000 });
    expect(last().sent).toEqual([{ type: "auth", payload: { token: "dev:3:AGENT", reconnect: false } }]);
    expect(opened).not.toHaveBeenCalled();

    last().server("connection.authenticated", { connectionId: "x", userId: "3", role: "AGENT" });
    expect(socket.readyState).toBe(1);
    expect(opened).toHaveBeenCalledOnce();
    expect(useSessionStore.getState()).toMatchObject({ userId: "3", role: "AGENT" });
  });

  it("marks later connections as reconnects", () => {
    connect();
    last().server("connection.established", {});
    last().server("connection.authenticated", { userId: "3", role: "AGENT" });
    connect();
    last().server("connection.established", {});
    expect(last().sent[0]?.payload).toMatchObject({ reconnect: true });
  });

  it("fails fast without a token, without opening a socket", () => {
    const { socket, closed } = connect(null);
    vi.runAllTimers();
    expect(FakeWs.instances).toHaveLength(0);
    expect(socket.readyState).toBe(3);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("stops retrying a token the gateway rejected", () => {
    connect("bad");
    last().onclose?.({ code: 4401 });
    const { closed } = connect("bad");
    vi.runAllTimers();
    expect(FakeWs.instances).toHaveLength(1); // no second socket for the same rejected token
    expect(closed).toHaveBeenCalledOnce();
    connect("fresh"); // a different token is tried
    expect(FakeWs.instances).toHaveLength(2);
  });

  it("clears the session when the connection closes", () => {
    const { socket } = connect();
    last().server("connection.authenticated", { userId: "3", role: "AGENT" });
    last().onclose?.({ code: 1006 });
    expect(socket.readyState).toBe(3);
    expect(useSessionStore.getState().userId).toBeNull();
  });
});

describe("BackendSocket translation", () => {
  const ready = () => {
    const c = connect();
    last().server("connection.established", {});
    last().server("connection.authenticated", { userId: "3", role: "AGENT" });
    last().sent.length = 0;
    return c;
  };

  it("sends client events to the gateway and delivers translated server events to the client", () => {
    const { socket, received } = ready();
    socket.send(
      JSON.stringify({ type: "message.send", payload: { conversationId: "12", clientId: "c-1", text: "hi" } }),
    );
    expect(last().sent).toEqual([
      { type: "message.send", payload: { conversationId: "12", clientId: "c-1", text: "hi" } },
    ]);

    last().server("conversation.hidden", { conversationId: "12" });
    expect(received).toEqual([{ type: "conversation.removed", payload: { conversationId: "12" } }]);
  });

  it("answers unsupported events locally instead of sending them", () => {
    const { socket, received } = ready();
    socket.send(JSON.stringify({ type: "callback.request", payload: { conversationId: "12" } }));
    expect(last().sent).toEqual([]);
    vi.runAllTimers();
    expect(received).toEqual([{ type: "notice", payload: { text: "Callback requests are not available yet" } }]);
  });

  it("ignores malformed frames and sends nothing before it is authenticated", () => {
    const { socket, received } = connect();
    socket.send(JSON.stringify({ type: "message.send", payload: {} }));
    expect(last().sent).toEqual([]);
    last().onmessage?.({ data: "not json" });
    last().server("presence.updated", { userId: "1", status: "BUSY" });
    expect(received).toEqual([]);
  });

  it("closes the underlying socket", () => {
    const { socket, closed } = ready();
    socket.close();
    expect(last().closed).toBe(true);
    expect(closed).toHaveBeenCalledOnce();
  });
});
