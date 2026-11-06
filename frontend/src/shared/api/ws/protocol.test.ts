import { describe, expect, it } from "vitest";
import { isServerEvent, type ChatMessageDto, type ConversationDto } from "./protocol";

const message: ChatMessageDto = {
  id: "m1",
  conversationId: "a",
  side: "customer",
  text: "hi",
  createdAt: "2026-01-01T09:00:00Z",
};

const conversation: ConversationDto = {
  id: "a",
  customerId: "cust-a",
  name: "A",
  avatar: "/a.png",
  preview: "hi",
  lastMessageAt: "2026-01-01T09:00:00Z",
  unread: 0,
  urgent: false,
  handoff: "ai",
  application: {
    appId: "1",
    product: "p",
    amount: "$1",
    tenor: "1m",
    status: "New",
    reference: "r",
  },
  activity: [],
  summary: "s",
};

describe("isServerEvent", () => {
  it.each([
    ["notice", { text: "x" }],
    ["message.new", { message }],
    ["message.ack", { message: { ...message, status: "sent" } }],
    ["message.status", { conversationId: "a", messageId: "m1", status: "read" }],
    ["conversation.updated", { conversation }],
    ["conversation.assigned", { conversationId: "a", agent: { id: "ag1", name: "Agent", avatar: "/ag.png" } }],
    ["typing", { conversationId: "a", side: "customer", active: true }],
    [
      "notification",
      {
        notification: {
          id: "n1",
          agentId: "ag1",
          type: "system",
          text: "hi",
          read: false,
          createdAt: "2026-01-01T09:00:00Z",
        },
      },
    ],
    ["sync", { conversations: [conversation], messages: { a: [message] } }],
    ["sync", { conversations: [], messages: {}, partial: true, incomplete: ["a"] }],
    ["message.new", { message: { ...message, side: "system", clientId: "c1", sequence: "4" } }],
    ["conversation.updated", { conversation: { ...conversation, archived: true } }],
    ["conversation.removed", { conversationId: "a" }],
    ["conversation.unread", { conversationId: "a", unread: 2 }],
    ["message.failed", { conversationId: "a", clientId: "c1", reason: "Not the owner" }],
  ])("accepts a valid %s payload", (type, payload) => {
    expect(isServerEvent(type, payload)).toBe(true);
  });

  it.each([
    ["notice", { text: 1 }],
    ["notice", null],
    ["notice", []],
    ["message.new", { message: { ...message, side: "robot" } }],
    ["message.new", { message: { ...message, status: "weird" } }],
    ["message.status", { conversationId: "a", messageId: "m1", status: "nope" }],
    ["conversation.updated", { conversation: { ...conversation, handoff: "x" } }],
    ["conversation.assigned", { conversationId: "a", agent: { id: "ag1", name: "Agent" } }],
    [
      "notification",
      {
        notification: {
          id: "n1",
          agentId: "ag1",
          type: "system",
          text: "hi",
          read: "yes",
          createdAt: "2026-01-01T09:00:00Z",
        },
      },
    ],
    ["typing", { conversationId: "a", side: "customer", active: "yes" }],
    ["sync", { conversations: [{}], messages: {} }],
    ["sync", { conversations: [], messages: {}, partial: "yes" }],
    ["sync", { conversations: [], messages: {}, incomplete: [1] }],
    ["conversation.removed", {}],
    ["conversation.unread", { conversationId: "a", unread: -1 }],
    ["conversation.unread", { conversationId: "a", unread: "2" }],
    ["message.failed", { conversationId: "a" }],
    ["message.new", { message: { ...message, sequence: 4 } }],
    ["sync", { conversations: [], messages: { a: [{ id: 1 }] } }],
    ["unknown.event", {}],
  ])("rejects an invalid %s payload", (type, payload) => {
    expect(isServerEvent(type, payload)).toBe(false);
  });
});

describe("workspace events", () => {
  it("accepts well-formed events and rejects malformed ones", () => {
    expect(isServerEvent("workspace.tab_opened", { conversationId: "a", sortOrder: 1, lastOpenedAt: "t" })).toBe(true);
    expect(isServerEvent("workspace.tab_opened", { conversationId: "a" })).toBe(false);
    expect(isServerEvent("workspace.tab_closed", { conversationId: "a" })).toBe(true);
    expect(isServerEvent("workspace.draft_updated", { conversationId: "a", content: null, updatedAt: "t" })).toBe(true);
    expect(isServerEvent("workspace.draft_updated", { conversationId: "a", content: 5, updatedAt: "t" })).toBe(false);
    expect(
      isServerEvent("workspace.preferences_updated", { preferences: { restoreTabs: true, persistTabs: false } }),
    ).toBe(true);
    expect(isServerEvent("workspace.preferences_updated", { preferences: { restoreTabs: true } })).toBe(false);
  });

  it("validates chat settings changes from another window", () => {
    const settings = {
      typingSoundEnabled: true,
      notificationSoundEnabled: true,
      aiSuggestionsEnabled: false,
      aiSummariesEnabled: true,
      autoAssignEnabled: false,
    };
    expect(isServerEvent("chat_settings.updated", { settings })).toBe(true);
    expect(isServerEvent("chat_settings.updated", { settings: { ...settings, autoAssignEnabled: "no" } })).toBe(false);
    expect(isServerEvent("chat_settings.updated", { settings: { typingSoundEnabled: true } })).toBe(false);
    expect(isServerEvent("chat_settings.updated", {})).toBe(false);
  });
});

describe("message action events", () => {
  it("validates edits, deletes and reaction updates", () => {
    expect(isServerEvent("message.updated", { message })).toBe(true);
    expect(isServerEvent("message.updated", { message: { id: "x" } })).toBe(false);
    expect(isServerEvent("message.deleted", { conversationId: "a", messageId: "m" })).toBe(true);
    expect(isServerEvent("message.deleted", { conversationId: "a" })).toBe(false);
    const reactions = [{ id: "r", userId: "u", emoji: "👍" }];
    expect(isServerEvent("message.reaction_updated", { conversationId: "a", messageId: "m", reactions })).toBe(true);
    expect(isServerEvent("message.reaction_updated", { conversationId: "a", messageId: "m", reactions: [{}] })).toBe(
      false,
    );
  });
});

describe("attachment events", () => {
  it("validates attachment.deleted", () => {
    expect(isServerEvent("attachment.deleted", { conversationId: "a", messageId: "m", attachmentId: "f" })).toBe(true);
    expect(isServerEvent("attachment.deleted", { conversationId: "a", messageId: null, attachmentId: "f" })).toBe(true);
    expect(isServerEvent("attachment.deleted", { conversationId: "a" })).toBe(false);
  });
});

describe("note and escalation events", () => {
  const note = {
    id: "n",
    conversationId: "a",
    authorId: "u",
    text: "t",
    mentionedAgentIds: [],
    edited: false,
    createdAt: "t",
  };
  it("validates notes and escalations", () => {
    expect(isServerEvent("note.created", { note })).toBe(true);
    expect(isServerEvent("note.updated", { note: { ...note, edited: "yes" } })).toBe(false);
    expect(isServerEvent("note.deleted", { conversationId: "a", noteId: "n" })).toBe(true);
    expect(isServerEvent("note.deleted", { conversationId: "a" })).toBe(false);
    const escalation = { conversationId: "a", escalationId: "e", status: "PENDING", requestedBy: "u" };
    expect(isServerEvent("conversation.escalated", escalation)).toBe(true);
    expect(isServerEvent("conversation.escalated", { ...escalation, status: "DONE" })).toBe(false);
  });
});
