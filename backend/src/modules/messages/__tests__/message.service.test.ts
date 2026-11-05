import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { NotificationService } from "@modules/notifications/index.js";
import type { MessageRepository } from "../message.repository.js";
import { MessageService } from "../message.service.js";
import type { LockedConversation, MessageRow } from "../message.types.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const repo = {
  inTransaction: vi.fn(),
  lock: vi.fn(),
  isViewer: vi.fn(),
  findByClientId: vi.fn(),
  findById: vi.fn(),
  append: vi.fn(),
  reopen: vi.fn(),
  addActivity: vi.fn(),
  history: vi.fn(),
  latest: vi.fn(),
  readPosition: vi.fn(),
  advanceRead: vi.fn(),
  receiptReadRange: vi.fn(),
  receiptDelivered: vi.fn(),
  markUnread: vi.fn(),
  unreadState: vi.fn(),
};
const notifications = { notifyAgent: vi.fn() };
const realtime = fakeRealtime();
const service = new MessageService(
  fromPartial<MessageRepository>(repo),
  fromPartial<NotificationService>(notifications),
  realtime,
);

const owner: AuthContext = { userId: 1n, role: "AGENT" };
const other: AuthContext = { userId: 2n, role: "AGENT" };
const at = new Date("2026-01-01T00:00:00Z");

const conv = (patch: Partial<LockedConversation> = {}): LockedConversation => ({
  id: 10n,
  customerId: 100n,
  status: "OPEN",
  handoffStatus: "ASSIGNED",
  assignedAgentId: 1n,
  isArchived: false,
  ...patch,
});
const msg = (patch: Partial<MessageRow> = {}): MessageRow =>
  fromPartial<MessageRow>({
    id: 50n,
    conversationId: 10n,
    clientId: "c1",
    sequenceNumber: 5n,
    senderType: "AGENT",
    senderId: 1n,
    messageType: "TEXT",
    content: "hello",
    metadata: null,
    status: "SENT",
    replyToMessageId: null,
    createdAt: at,
    ...patch,
  });

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  repo.lock.mockResolvedValue(conv());
  repo.isViewer.mockResolvedValue(false);
  repo.findByClientId.mockResolvedValue(null);
  repo.append.mockResolvedValue(msg());
  notifications.notifyAgent.mockResolvedValue(true);
});

describe("send", () => {
  const input = { clientId: "c1", text: "hello" };

  it("stores the message with the sender, text and an inbox preview", async () => {
    const result = await service.send(owner, 10n, input);
    expect(result.created).toBe(true);
    expect(result.message).toMatchObject({ id: "50", sequenceNumber: "5", senderType: "AGENT", status: "SENT" });
    expect(repo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        senderType: "AGENT",
        senderId: 1n,
        clientId: "c1",
        content: "hello",
        preview: "hello",
      }),
    );
  });

  it("announces a new message to everyone except the sending socket, and not again on a retry", async () => {
    await service.send(owner, 10n, input, "conn-1");
    expect(realtime.messageCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "50", conversationId: "10" }), {
      conversationUpdated: true,
      origin: "conn-1",
    });
    realtime.messageCreated.mockClear();
    repo.findByClientId.mockResolvedValue(msg());
    await service.send(owner, 10n, input, "conn-1");
    expect(realtime.messageCreated).not.toHaveBeenCalled();
  });

  it("returns the original message on a retry instead of inserting again", async () => {
    repo.findByClientId.mockResolvedValue(msg());
    const result = await service.send(owner, 10n, input);
    expect(result.created).toBe(false);
    expect(repo.append).not.toHaveBeenCalled();
  });

  it("refuses a clientId that belongs to someone else's message", async () => {
    repo.findByClientId.mockResolvedValue(msg({ senderId: 9n }));
    await expect(service.send(owner, 10n, input)).rejects.toBeInstanceOf(ConflictError);
  });

  it("is 403 for a non-owner who can see the chat, and 404 when it is hidden", async () => {
    repo.lock.mockResolvedValue(conv({ handoffStatus: "NEEDS_HUMAN", assignedAgentId: null }));
    await expect(service.send(other, 10n, input)).rejects.toBeInstanceOf(ForbiddenError);
    repo.lock.mockResolvedValue(conv());
    await expect(service.send(other, 10n, input)).rejects.toBeInstanceOf(NotFoundError);
    repo.lock.mockResolvedValue(null);
    await expect(service.send(owner, 10n, input)).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.append).not.toHaveBeenCalled();
  });

  it("refuses closed and archived conversations", async () => {
    repo.lock.mockResolvedValue(conv({ status: "CLOSED" }));
    await expect(service.send(owner, 10n, input)).rejects.toBeInstanceOf(ForbiddenError);
    repo.lock.mockResolvedValue(conv({ isArchived: true }));
    await expect(service.send(owner, 10n, input)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requires a reply target from the same conversation", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.send(owner, 10n, { ...input, replyToMessageId: 3n })).rejects.toBeInstanceOf(BadRequestError);
    repo.findById.mockResolvedValue(msg({ id: 3n }));
    await service.send(owner, 10n, { ...input, replyToMessageId: 3n });
    expect(repo.append).toHaveBeenCalledWith(expect.objectContaining({ replyToMessageId: 3n }));
  });

  it("cuts the preview by characters, never inside a surrogate pair", async () => {
    await service.send(owner, 10n, { clientId: "c", text: "😀".repeat(300) });
    const preview = repo.append.mock.calls[0]?.[0].preview as string;
    expect(Array.from(preview)).toHaveLength(255);
    expect(preview.endsWith("😀")).toBe(true);
  });
});

describe("receiveFromCustomer", () => {
  const input = { customerId: 100n, conversationId: 10n, clientId: "cc1", text: "help" };

  it("stores the message and notifies the owning agent", async () => {
    repo.append.mockResolvedValue(msg({ senderType: "CUSTOMER", senderId: 100n, clientId: "cc1" }));
    const result = await service.receiveFromCustomer(input);
    expect(result.created).toBe(true);
    expect(repo.reopen).not.toHaveBeenCalled();
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 1n, type: "NEW_MESSAGE", conversationId: 10n, messageId: 50n }),
    );
  });

  it("reopens a resolved conversation and records why", async () => {
    repo.lock.mockResolvedValue(conv({ status: "RESOLVED", handoffStatus: "NONE", assignedAgentId: null }));
    await service.receiveFromCustomer(input);
    expect(repo.reopen).toHaveBeenCalledWith(10n);
    expect(repo.addActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "CUSTOMER",
        metadata: expect.objectContaining({ reason: "customer_message" }),
      }),
    );
    expect(notifications.notifyAgent).not.toHaveBeenCalled(); // nobody owns it
  });

  it("is idempotent, and rejects another customer's conversation", async () => {
    repo.findByClientId.mockResolvedValue(msg({ senderType: "CUSTOMER", senderId: 100n }));
    expect((await service.receiveFromCustomer(input)).created).toBe(false);
    expect(notifications.notifyAgent).not.toHaveBeenCalled();
    await expect(service.receiveFromCustomer({ ...input, customerId: 999n })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("announces the customer message to viewers of the conversation", async () => {
    repo.append.mockResolvedValue(msg({ senderType: "CUSTOMER", senderId: 100n }));
    await service.receiveFromCustomer(input);
    expect(realtime.messageCreated).toHaveBeenCalledWith(expect.objectContaining({ senderType: "CUSTOMER" }), {
      conversationUpdated: true,
    });
  });

  it("still succeeds when the notification fails", async () => {
    notifications.notifyAgent.mockRejectedValue(new Error("down"));
    await expect(service.receiveFromCustomer(input)).resolves.toMatchObject({ created: true });
  });
});

describe("post (system messages)", () => {
  it("appends a SYSTEM message without touching the preview", async () => {
    await service.post(10n, "Agent 1 took over", { event: "takeover" });
    expect(realtime.messageCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "50" }));
    expect(repo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        senderType: "SYSTEM",
        senderId: null,
        messageType: "SYSTEM",
        clientId: null,
        preview: null,
      }),
    );
  });

  it("ignores a conversation that no longer exists", async () => {
    repo.lock.mockResolvedValue(null);
    await service.post(10n, "x");
    expect(repo.append).not.toHaveBeenCalled();
  });
});

describe("history", () => {
  it("returns messages with cursor metadata after an access check", async () => {
    repo.history.mockResolvedValue({
      items: [msg({ sequenceNumber: 4n }), msg({ sequenceNumber: 5n })],
      hasMore: true,
    });
    const result = await service.history(owner, 10n, { limit: 2 });
    expect(result.meta).toEqual({
      limit: 2,
      hasMore: true,
      direction: "older",
      oldestSequence: "4",
      newestSequence: "5",
    });
    const sync = await service.history(owner, 10n, { limit: 2, after: 3n });
    expect(sync.meta.direction).toBe("newer");
  });

  it("hides inaccessible conversations", async () => {
    await expect(service.history(other, 10n, { limit: 5 })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.history).not.toHaveBeenCalled();
  });

  it("returns empty metadata for an empty conversation", async () => {
    repo.history.mockResolvedValue({ items: [], hasMore: false });
    expect((await service.history(owner, 10n, { limit: 5 })).meta).toMatchObject({
      oldestSequence: null,
      newestSequence: null,
    });
  });
});

describe("markRead", () => {
  beforeEach(() => {
    repo.latest.mockResolvedValue(msg({ id: 9n, sequenceNumber: 9n }));
    repo.readPosition.mockResolvedValue(4n);
    repo.unreadState.mockResolvedValue({ position: 9n, unread: 0, markedUnread: false });
    repo.receiptReadRange.mockResolvedValue([60n, 61n]);
  });

  it("advances to the latest message and records receipts for the newly read range", async () => {
    const state = await service.markRead(owner, 10n);
    expect(repo.advanceRead).toHaveBeenCalledWith(10n, 1n, 9n, 9n);
    expect(repo.receiptReadRange).toHaveBeenCalledWith(10n, 1n, 4n, 9n);
    expect(state).toEqual({ conversationId: "10", lastReadSequenceNumber: "9", markedUnread: false, unreadCount: 0 });
    expect(realtime.readState).toHaveBeenCalledWith(1n, state); // the agent's other tabs
    expect(realtime.messageStatus).toHaveBeenCalledWith(10n, [60n, 61n], "READ");
  });

  it("does not create receipts when nothing new was read (an older tab)", async () => {
    repo.findById.mockResolvedValue(msg({ id: 3n, sequenceNumber: 3n }));
    await service.markRead(owner, 10n, 3n);
    expect(repo.receiptReadRange).not.toHaveBeenCalled();
    expect(realtime.messageStatus).toHaveBeenCalledWith(10n, [], "READ"); // nothing newly read: the notifier ignores it
  });

  it("404s for a message outside the conversation, and does nothing for an empty one", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.markRead(owner, 10n, 77n)).rejects.toBeInstanceOf(NotFoundError);
    repo.latest.mockResolvedValue(null);
    await service.markRead(owner, 10n);
    expect(repo.advanceRead).not.toHaveBeenCalled();
  });

  it("is hidden from agents who cannot see the conversation", async () => {
    await expect(service.markRead(other, 10n)).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.advanceRead).not.toHaveBeenCalled();
  });
});

describe("markUnread / markDelivered", () => {
  it("flags unread, keeps the read position, and reports at least one unread", async () => {
    repo.unreadState.mockResolvedValue({ position: 8n, unread: 0, markedUnread: true });
    const state = await service.markUnread(owner, 10n);
    expect(repo.markUnread).toHaveBeenCalledWith(10n, 1n);
    expect(state).toMatchObject({ markedUnread: true, unreadCount: 1 });
  });

  it("records delivery only for the caller and only for customer messages", async () => {
    repo.findById.mockResolvedValue(msg({ senderType: "CUSTOMER", senderId: 100n }));
    await service.markDelivered(owner, 10n, 50n);
    expect(repo.receiptDelivered).toHaveBeenCalledWith(50n, 1n);
    expect(realtime.messageStatus).not.toHaveBeenCalled(); // status did not advance (mock returns undefined)
    repo.findById.mockResolvedValue(msg({ senderType: "AGENT" }));
    await expect(service.markDelivered(owner, 10n, 50n)).rejects.toBeInstanceOf(BadRequestError);
    repo.findById.mockResolvedValue(null);
    await expect(service.markDelivered(owner, 10n, 50n)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.markDelivered(other, 10n, 50n)).rejects.toBeInstanceOf(NotFoundError); // hidden chat
  });
});
