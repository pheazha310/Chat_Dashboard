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
  name: "A",
  avatar: "/a.png",
  preview: "hi",
  lastMessageAt: "2026-01-01T09:00:00Z",
  unread: 0,
  urgent: false,
  handoff: "ai",
  application: { appId: "1", product: "p", amount: "$1", tenor: "1m", status: "new", reference: "r" },
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
    ["typing", { conversationId: "a", side: "customer", active: true }],
    ["sync", { conversations: [conversation], messages: { a: [message] } }],
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
    ["typing", { conversationId: "a", side: "customer", active: "yes" }],
    ["sync", { conversations: [{}], messages: {} }],
    ["sync", { conversations: [], messages: { a: [{ id: 1 }] } }],
    ["unknown.event", {}],
  ])("rejects an invalid %s payload", (type, payload) => {
    expect(isServerEvent(type, payload)).toBe(false);
  });
});
