import { describe, expect, it } from "vitest";
import { isServerEvent } from "../ws/protocol";
import { toActivity, toConversation, toMessage, toNotification } from "./mappers";
import type { BackendConversation, BackendMessage } from "./types";

const conversation: BackendConversation = {
  id: "12",
  customerId: "100",
  customerName: "Maya Chen",
  customerIdentifier: "C-100",
  applicationId: "7",
  subject: null,
  status: "OPEN",
  priority: "HIGH",
  conversationMode: "HUMAN",
  handoffStatus: "NEEDS_HUMAN",
  assignedAgentId: null,
  assignedAgent: null,
  isArchived: false,
  lastMessageAt: "2026-01-01T09:12:00.000Z",
  lastMessagePreview: "CM repayment schedule needs review",
};

describe("toConversation", () => {
  it("maps the backend conversation onto the DTO the UI already renders, and passes the protocol validator", () => {
    const dto = toConversation(conversation, 3);
    expect(dto).toMatchObject({
      id: "12",
      customerId: "100",
      name: "Maya Chen",
      preview: "CM repayment schedule needs review",
      unread: 3,
      urgent: true,
      handoff: "needs-human",
      archived: false,
    });
    expect(dto.avatar).toMatch(/^data:image\/svg\+xml/);
    expect(isServerEvent("conversation.updated", { conversation: dto })).toBe(true);
  });

  it("does not invent loan data: unknown application fields show a dash", () => {
    expect(toConversation(conversation, 0).application).toEqual({
      appId: "7",
      product: "—",
      amount: "—",
      tenor: "—",
      status: "Unknown",
      reference: "7",
    });
  });

  it.each([
    ["NONE", "ai"],
    ["NEEDS_HUMAN", "needs-human"],
    ["ASSIGNED", "assigned"],
  ] as const)("maps handoff %s to %s", (handoffStatus, expected) => {
    expect(toConversation({ ...conversation, handoffStatus }, 0).handoff).toBe(expected);
  });

  it("uses the assigned agent's profile, a fallback name, and only HIGH priority is urgent", () => {
    const dto = toConversation(
      {
        ...conversation,
        customerName: null,
        priority: "MEDIUM",
        assignedAgentId: "3",
        assignedAgent: { id: "3", name: "Sarah Chen", avatarUrl: "/a.png" },
      },
      0,
    );
    expect(dto.name).toBe("Customer 100");
    expect(dto.urgent).toBe(false);
    expect(dto.assignedAgent).toEqual({ id: "3", name: "Sarah Chen", avatar: "/a.png", active: true });
  });
});

describe("toMessage", () => {
  const message: BackendMessage = {
    id: "50",
    conversationId: "12",
    clientId: "c-1",
    sequenceNumber: "7",
    senderType: "AGENT",
    senderId: "3",
    type: "TEXT",
    content: "Hello",
    status: "DELIVERED",
    createdAt: "2026-01-01T09:12:00.000Z",
  };

  it("maps sender, status, client id and sequence", () => {
    const dto = toMessage(message);
    expect(dto).toEqual({
      id: "50",
      conversationId: "12",
      side: "agent",
      text: "Hello",
      createdAt: "2026-01-01T09:12:00.000Z",
      status: "delivered",
      senderId: "3",
      clientId: "c-1",
      sequence: "7",
    });
    expect(isServerEvent("message.new", { message: dto })).toBe(true);
  });

  it("maps system messages and tolerates missing content and sender", () => {
    const dto = toMessage({ ...message, senderType: "SYSTEM", senderId: null, clientId: null, content: null });
    expect(dto).toMatchObject({ side: "system", text: "" });
    expect(dto).not.toHaveProperty("senderId");
    expect(dto).not.toHaveProperty("clientId");
    expect(isServerEvent("message.new", { message: dto })).toBe(true);
  });
});

describe("toActivity / toNotification", () => {
  it("humanizes activity types and picks a tone", () => {
    expect(
      toActivity({
        id: "1",
        conversationId: "12",
        activityType: "STATUS_CHANGED",
        description: "Resolved",
        createdAt: "2026-01-01T09:12:00.000Z",
      }),
    ).toMatchObject({
      title: "Status changed",
      tone: "cyan",
      copy: "Resolved",
    });
    expect(
      toActivity({
        id: "2",
        conversationId: "12",
        activityType: "ASSIGNED",
        description: null,
        createdAt: "2026-01-01T09:12:00.000Z",
      }),
    ).toMatchObject({ tone: "blue", copy: "" });
  });

  it("maps notification types and joins title and body", () => {
    const n = {
      id: "9",
      type: "NEW_CONVERSATION",
      title: "New conversation",
      body: "Maya waits",
      conversationId: "12",
      read: false,
      createdAt: "2026-01-01T09:12:00.000Z",
    };
    expect(toNotification(n, "3")).toEqual({
      id: "9",
      agentId: "3",
      type: "new-conversation",
      text: "New conversation: Maya waits",
      read: false,
      createdAt: "2026-01-01T09:12:00.000Z",
    });
    expect(toNotification({ ...n, type: "TRANSFERRED", body: null }, "3")).toMatchObject({
      type: "handoff",
      text: "New conversation",
    });
    expect(toNotification({ ...n, type: "NEW_MESSAGE" }, "3").type).toBe("system");
  });
});
