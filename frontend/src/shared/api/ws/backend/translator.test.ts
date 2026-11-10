import { beforeEach, describe, expect, it } from "vitest";
import { isServerEvent } from "../protocol";
import { BackendTranslator } from "./translator";

const conversation = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  customerId: "100",
  customerName: "Maya Chen",
  customerIdentifier: null,
  applicationId: 7,
  subject: null,
  status: "OPEN",
  priority: "MEDIUM",
  conversationMode: "HUMAN",
  handoffStatus: "ASSIGNED",
  assignedAgentId: "3",
  assignedAgent: { id: "3", name: "Sarah Chen", avatarUrl: null },
  isArchived: false,
  lastMessageAt: "2026-01-01T09:00:00.000Z",
  lastMessagePreview: "hello",
  ...patch,
});
const message = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  conversationId: "12",
  clientId: null,
  sequenceNumber: id,
  senderType: "CUSTOMER",
  senderId: "100",
  type: "TEXT",
  content: `m${id}`,
  status: "SENT",
  createdAt: "2026-01-01T09:00:00.000Z",
  ...patch,
});

let t: BackendTranslator;
const from = (type: string, payload: Record<string, unknown>) => t.fromBackend({ type, payload });
const one = (type: string, payload: Record<string, unknown>) => {
  const [event, ...rest] = from(type, payload);
  expect(rest).toEqual([]);
  return event!;
};

beforeEach(() => {
  t = new BackendTranslator();
  t.userId = "3";
});

describe("every translated event passes the frontend's protocol validator", () => {
  it.each([
    [
      "sync",
      { conversations: [conversation("12", { unreadCount: 2 })], messages: { "12": [message("5")] }, incomplete: [] },
    ],
    ["message.new", { message: message("6") }],
    [
      "message.ack",
      { clientId: "c-1", created: true, message: message("7", { senderType: "AGENT", clientId: "c-1" }) },
    ],
    ["conversation.updated", { conversationId: "12", conversation: conversation("12") }],
    ["conversation.assigned", { conversationId: "12", conversation: conversation("12") }],
    ["conversation.read", { conversationId: "12", unreadCount: 0, markedUnread: false }],
    ["conversation.hidden", { conversationId: "12" }],
    ["message.status", { conversationId: "12", messageIds: ["5"], status: "READ" }],
    ["message.failed", { conversationId: "12", clientId: "c-1", code: "FORBIDDEN", message: "Not the owner" }],
    ["typing", { conversationId: "12", userId: "3", side: "agent", active: true }],
    [
      "notification.new",
      {
        notification: {
          id: "1",
          type: "ASSIGNED",
          title: "t",
          body: null,
          conversationId: "12",
          read: false,
          createdAt: "2026-01-01T09:00:00.000Z",
        },
      },
    ],
    ["error", { code: "FORBIDDEN", message: "Nope" }],
  ])("%s", (type, payload) => {
    for (const event of from(type, payload as Record<string, unknown>)) {
      expect(isServerEvent(event.type, event.payload), `${type} -> ${event.type}`).toBe(true);
    }
  });
});

describe("inbox and unread counts", () => {
  it("turns a sync into a partial merge with the server's unread counts and the assigned agents", () => {
    const event = one("sync", {
      conversations: [
        conversation("12", { unreadCount: 2 }),
        conversation("13", { assignedAgent: null, handoffStatus: "NEEDS_HUMAN" }),
      ],
      messages: { "12": [message("5")] },
      incomplete: ["12"],
    });
    expect(event.type).toBe("sync");
    const payload = event.payload as {
      conversations: { id: string; unread: number }[];
      partial: boolean;
      incomplete: string[];
      agents: unknown[];
    };
    expect(payload.conversations.map((c) => [c.id, c.unread])).toEqual([
      ["12", 2],
      ["13", 0],
    ]);
    expect(payload).toMatchObject({ partial: true, incomplete: ["12"] });
    expect(payload.agents).toHaveLength(1);
  });

  it("counts each customer message and carries the count on the next conversation update", () => {
    one("sync", { conversations: [conversation("12", { unreadCount: 1 })], messages: {} });
    from("message.new", { message: message("6") });
    from("message.new", { message: message("7", { senderType: "AGENT" }) }); // not unread for the agent
    from("message.new", { message: message("8", { senderType: "SYSTEM", senderId: null }) });
    const update = one("conversation.updated", { conversation: conversation("12") });
    expect((update.payload as { conversation: { unread: number } }).conversation.unread).toBe(2);
  });

  it("follows the authoritative count from conversation.read, and forgets removed conversations", () => {
    from("message.new", { message: message("6") });
    expect(one("conversation.read", { conversationId: "12", unreadCount: 0 })).toEqual({
      type: "conversation.unread",
      payload: { conversationId: "12", unread: 0 },
    });
    const update = one("conversation.updated", { conversation: conversation("12") });
    expect((update.payload as { conversation: { unread: number } }).conversation.unread).toBe(0);
    expect(one("conversation.hidden", { conversationId: "12" }).type).toBe("conversation.removed");
  });

  it.each(["conversation.created", "conversation.assigned", "conversation.transferred", "conversation.status_changed"])(
    "shows %s as a conversation update",
    (type) => {
      expect(one(type, { conversationId: "12", conversation: conversation("12") }).type).toBe("conversation.updated");
    },
  );
});

describe("messages", () => {
  it("keeps the client id on an ack so the optimistic message can be replaced", () => {
    const ack = one("message.ack", {
      clientId: "c-1",
      created: true,
      message: message("7", { senderType: "AGENT", clientId: "c-1" }),
    });
    expect((ack.payload as { message: { clientId: string; id: string } }).message).toMatchObject({
      id: "7",
      clientId: "c-1",
    });
  });

  it("fans one batched status out to one event per message", () => {
    const events = from("message.status", { conversationId: "12", messageIds: ["5", "6"], status: "READ" });
    expect(events.map((e) => e.payload)).toEqual([
      { conversationId: "12", messageId: "5", status: "read" },
      { conversationId: "12", messageId: "6", status: "read" },
    ]);
    expect(from("message.status", { conversationId: "12", messageIds: [], status: "READ" })).toEqual([]);
  });

  it("reports a failed send with the server's reason", () => {
    expect(
      one("message.failed", { conversationId: "12", clientId: "c-1", code: "FORBIDDEN", message: "Not the owner" })
        .payload,
    ).toEqual({
      conversationId: "12",
      clientId: "c-1",
      reason: "Not the owner",
    });
  });
});

describe("notifications, errors and events with no UI", () => {
  it("maps a notification onto the signed-in agent", () => {
    const event = one("notification.new", {
      notification: {
        id: "1",
        type: "NEW_CONVERSATION",
        title: "New",
        body: "Maya waits",
        conversationId: "12",
        read: false,
        createdAt: "2026-01-01T09:00:00.000Z",
      },
    });
    expect(event.payload).toMatchObject({
      notification: { agentId: "3", type: "new-conversation", text: "New: Maya waits" },
    });
  });

  it("shows server errors as notices, and ignores presence and notification.read", () => {
    expect(one("error", { code: "CONFLICT", message: "Already taken" })).toEqual({
      type: "notice",
      payload: { text: "Already taken" },
    });
    expect(from("presence.updated", { userId: "1", status: "BUSY" })).toEqual([]);
    expect(from("notification.read", { notificationId: null, unreadCount: 0 })).toEqual([]);
    expect(from("connection.authenticated", {})).toEqual([]);
  });
});

describe("outgoing events", () => {
  it.each([
    ["message.send", { conversationId: "12", clientId: "c-1", text: "hi" }],
    ["conversation.read", { conversationId: "12" }],
    ["conversation.unread", { conversationId: "12" }],
    ["conversation.takeover", { conversationId: "12" }],
    ["sync.request", { cursors: { "12": "9" }, selectedConversationId: "12" }],
  ])("passes %s through unchanged", (type, payload) => {
    expect(t.toBackend(type, payload)).toEqual({ send: [{ type, payload }], reply: [] });
  });

  it("answers callback requests locally because the backend has no such flow", () => {
    const { send, reply } = t.toBackend("callback.request", { conversationId: "12" });
    expect(send).toEqual([]);
    expect(reply).toEqual([{ type: "notice", payload: { text: "Callback requests are not available yet" } }]);
  });
});
