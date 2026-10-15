import { beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => {
  const handlers = new Map<string, (payload: never) => void>();
  let statusListener: ((status: string) => void) | undefined;
  return {
    handlers,
    emitStatus: (status: string) => statusListener?.(status),
    client: {
      on: vi.fn((type: string, handler: (payload: never) => void) => {
        handlers.set(type, handler);
        return () => handlers.delete(type);
      }),
      onStatus: vi.fn((listener: (status: string) => void) => {
        statusListener = listener;
        return () => {
          statusListener = undefined;
        };
      }),
      send: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
  };
});
vi.mock("@/shared/api/ws", () => ({ wsClient: ws.client }));
vi.mock("@/shared/ui", () => ({ notify: vi.fn() }));

import { useConversationStore, type Conversation } from "@/entities/conversation";
import { useMessageStore } from "@/entities/message";
import { startRealtime } from "./realtime";

const emit = (type: string, payload: unknown) => ws.handlers.get(type)?.(payload as never);
const conversation = (id: string, overrides: Partial<Conversation> = {}) =>
  ({ id, name: id, lastMessageAt: "t1", unread: 0, ...overrides }) as Conversation;

let stop: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  ws.handlers.clear();
  useConversationStore.setState({ byId: {}, order: [], selectedId: null, query: "" });
  useMessageStore.setState({ byConversation: {}, typing: {} });
  stop?.();
  stop = startRealtime();
});

describe("startRealtime", () => {
  it("connects and requests a sync once the socket opens", () => {
    expect(ws.client.connect).toHaveBeenCalled();
    ws.emitStatus("connecting");
    expect(ws.client.send).not.toHaveBeenCalled();
    ws.emitStatus("open");
    expect(ws.client.send).toHaveBeenCalledWith("sync.request", {});
  });

  it("loads conversations and messages from a sync event", () => {
    emit("sync", { conversations: [conversation("a")], messages: { a: [{ id: "m1", conversationId: "a" }] } });
    expect(useConversationStore.getState().order).toEqual(["a"]);
    expect(useMessageStore.getState().byConversation.a).toHaveLength(1);
  });

  it("marks updates to the open conversation as read and tells the server", () => {
    emit("sync", { conversations: [conversation("a")], messages: {} });
    emit("conversation.updated", { conversation: conversation("a", { unread: 2, lastMessageAt: "t2" }) });
    expect(useConversationStore.getState().byId.a.unread).toBe(0);
    expect(ws.client.send).toHaveBeenCalledWith("conversation.read", { conversationId: "a" });
  });

  it("keeps unread for conversations that are not open", () => {
    emit("sync", { conversations: [conversation("a"), conversation("b")], messages: {} });
    emit("conversation.updated", { conversation: conversation("b", { unread: 2, lastMessageAt: "t2" }) });
    expect(useConversationStore.getState().byId.b.unread).toBe(2);
    expect(ws.client.send).not.toHaveBeenCalledWith("conversation.read", expect.anything());
  });

  it("tears down listeners and disconnects", () => {
    stop();
    expect(ws.client.disconnect).toHaveBeenCalled();
    expect(ws.handlers.size).toBe(0);
  });
});
