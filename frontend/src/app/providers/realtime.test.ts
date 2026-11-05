import { beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => {
  const handlers = new Map<string, (payload: never) => void>();
  let statusListener: ((status: string) => void) | undefined;
  return {
    handlers,
    emitStatus: (status: string) => statusListener?.(status),
    transport: { mock: true },
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
vi.mock("@/shared/api/ws", () => ({
  wsClient: ws.client,
  get isMockTransport() {
    return ws.transport.mock;
  },
}));
const history = vi.hoisted(() => ({ loadHistory: vi.fn(), catchUp: vi.fn(), loadDetails: vi.fn() }));
vi.mock("@/entities/message", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/entities/message")>()),
  loadHistory: history.loadHistory,
  catchUp: history.catchUp,
}));
vi.mock("@/entities/conversation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/entities/conversation")>()),
  loadDetails: history.loadDetails,
}));
const browser = vi.hoisted(() => ({ show: vi.fn(), request: vi.fn() }));
vi.mock("@/shared/lib/browser-notification", () => ({
  showBrowserNotification: browser.show,
  requestBrowserNotificationPermission: browser.request,
}));
vi.mock("@/shared/ui", () => ({ notify: vi.fn() }));

import { useConversationStore, type Conversation } from "@/entities/conversation";
import { useMessageStore } from "@/entities/message";
import { useSessionStore } from "@/shared/api/session";
import { notify } from "@/shared/ui";
import { startRealtime } from "./realtime";

const emit = (type: string, payload: unknown) => ws.handlers.get(type)?.(payload as never);
const conversation = (id: string, overrides: Partial<Conversation> = {}) =>
  ({ id, name: id, lastMessageAt: "t1", unread: 0, activity: [], summary: "", ...overrides }) as Conversation;

let stop: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  ws.transport.mock = true;
  useSessionStore.setState({ userId: null, role: null });
  ws.handlers.clear();
  useConversationStore.setState({ byId: {}, order: [], selectedId: null, query: "" });
  useMessageStore.setState({ byConversation: {}, typing: {}, history: {} });
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

  it("asks for only what is missing on reconnect, using the sequence numbers already held", () => {
    useConversationStore.setState({ selectedId: "a" });
    useMessageStore.setState({
      byConversation: {
        a: [
          { id: "m1", conversationId: "a", sequence: "4" },
          { id: "m2", conversationId: "a", sequence: "9" },
        ],
        b: [{ id: "m3", conversationId: "b", sequence: "2" }],
        c: [{ id: "opt", conversationId: "c", status: "sending" }],
      },
    } as never);
    ws.emitStatus("open");
    expect(ws.client.send).toHaveBeenCalledWith("sync.request", {
      cursors: { a: "9", b: "2" },
      selectedConversationId: "a",
    });
  });

  describe("with the real backend", () => {
    beforeEach(() => {
      ws.transport.mock = false;
    });

    it("merges a partial sync into the message lists instead of replacing them", () => {
      useMessageStore.setState({ byConversation: { a: [{ id: "old", conversationId: "a", sequence: "1" }] } } as never);
      emit("sync", {
        conversations: [conversation("a")],
        messages: { a: [{ id: "new", conversationId: "a", sequence: "2" }] },
        partial: true,
      });
      expect(useMessageStore.getState().byConversation.a.map((m) => m.id)).toEqual(["old", "new"]);
    });

    it("loads history and details of the open conversation after a sync, and pages the incomplete ones", () => {
      emit("sync", { conversations: [conversation("a"), conversation("b")], messages: {}, incomplete: ["b"] });
      expect(history.loadHistory).toHaveBeenCalledWith("a");
      expect(history.loadDetails).toHaveBeenCalledWith("a");
      expect(history.catchUp).toHaveBeenCalledWith("b");
    });

    it("drops a conversation another agent now owns, but supervisors keep seeing it", () => {
      const other = { id: "9", name: "Other Agent", avatar: "", active: true };
      emit("sync", { conversations: [conversation("a"), conversation("b")], messages: {} });
      useSessionStore.setState({ userId: "3", role: "AGENT" });
      emit("conversation.updated", {
        conversation: conversation("b", { handoff: "assigned", assignedAgent: other, lastMessageAt: "t2" }),
      });
      expect(useConversationStore.getState().byId.b).toBeUndefined();
      expect(notify).toHaveBeenCalledWith("Conversation moved to Other Agent");

      emit("conversation.updated", {
        conversation: conversation("a", {
          handoff: "assigned",
          assignedAgent: { ...other, id: "3" },
          lastMessageAt: "t3",
        }),
      });
      expect(useConversationStore.getState().byId.a?.handoff).toBe("assigned"); // mine: stays

      useSessionStore.setState({ userId: "1", role: "SUPERVISOR" });
      emit("conversation.updated", {
        conversation: conversation("c", { handoff: "assigned", assignedAgent: other, lastMessageAt: "t4" }),
      });
      expect(useConversationStore.getState().byId.c).toBeDefined();
    });

    it("does not fake an assignment on a new conversation (auto-assign is a mock-only demo)", () => {
      emit("sync", { conversations: [conversation("a")], messages: {} });
      emit("conversation.updated", {
        conversation: conversation("n", { handoff: "needs-human", lastMessageAt: "t3" }),
      });
      expect(useConversationStore.getState().byId.n.handoff).toBe("needs-human");
      expect(useConversationStore.getState().byId.n.assignedAgent).toBeUndefined();
    });

    it("marks the optimistic message failed and shows the server's reason", () => {
      useMessageStore.setState({
        byConversation: { a: [{ id: "c-1", conversationId: "a", status: "sending" }] },
      } as never);
      emit("message.failed", { conversationId: "a", clientId: "c-1", reason: "Not the owner" });
      expect(useMessageStore.getState().byConversation.a[0]?.status).toBe("failed");
      expect(notify).toHaveBeenCalledWith("Not the owner");
    });

    it("drops conversations the agent lost access to, and applies authoritative unread counts", () => {
      emit("sync", { conversations: [conversation("a"), conversation("b", { unread: 3 })], messages: {} });
      emit("conversation.unread", { conversationId: "b", unread: 0 });
      expect(useConversationStore.getState().byId.b.unread).toBe(0);
      emit("conversation.removed", { conversationId: "b" });
      expect(useConversationStore.getState().byId.b).toBeUndefined();
      expect(useConversationStore.getState().order).toEqual(["a"]);
    });

    it("keeps loaded details when a realtime update (which carries none) arrives", () => {
      emit("sync", { conversations: [conversation("a", { activity: [], summary: "" })], messages: {} });
      useConversationStore.getState().patch("a", { summary: "Wants a new date", activity: [{ id: "x" }] as never });
      emit("conversation.updated", {
        conversation: conversation("a", { activity: [], summary: "", lastMessageAt: "t9" }),
      });
      expect(useConversationStore.getState().byId.a.summary).toBe("Wants a new date");
      expect(useConversationStore.getState().byId.a.activity).toHaveLength(1);
    });

    it("shows a toast and a desktop notification for server notifications", () => {
      emit("notification", { notification: { id: "1", text: "Conversation assigned to you" } });
      expect(notify).toHaveBeenCalledWith("Conversation assigned to you");
      expect(browser.show).toHaveBeenCalledWith("Chat Dashboard", "Conversation assigned to you");
    });
  });
});
