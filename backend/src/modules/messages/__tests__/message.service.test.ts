import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { NotificationService } from "@modules/notifications/index.js";
import type { MessageRepository } from "../message.repository.js";
import { MessageService } from "../message.service.js";
import type { LockedConversation, MessageRow } from "../message.types.js";
import { uid } from "../../../__tests__/support/ids.js";

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
  reactionsFor: vi.fn(),
  attachmentsFor: vi.fn(),
  addAttachment: vi.fn(),
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
const guard = { isBlocked: vi.fn(), matchedKeywords: vi.fn() };
const service = new MessageService(
  fromPartial<MessageRepository>(repo),
  fromPartial<NotificationService>(notifications),
  realtime,
  () => guard,
);

const owner: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const at = new Date("2026-01-01T00:00:00Z");

const conv = (patch: Partial<LockedConversation> = {}): LockedConversation => ({
  id: uid(10),
  customerId: uid(100),
  conversationType: "CUSTOMER_SUPPORT",
  status: "OPEN",
  handoffStatus: "ASSIGNED",
  assignedAgentId: uid(1),
  isArchived: false,
  ...patch,
});
const msg = (patch: Partial<MessageRow> = {}): MessageRow =>
  fromPartial<MessageRow>({
    id: uid(50),
    conversationId: uid(10),
    clientId: "c1",
    sequenceNumber: 5n,
    senderType: "AGENT",
    senderId: uid(1),
    messageType: "TEXT",
    content: "hello",
    metadata: null,
    status: "SENT",
    replyToMessageId: null,
    forwardedFromMessageId: null,
    isEdited: false,
    editedAt: null,
    createdAt: at,
    ...patch,
  });

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  repo.lock.mockResolvedValue(conv());
  repo.isViewer.mockResolvedValue(false);
  repo.reactionsFor.mockResolvedValue(new Map());
  repo.attachmentsFor.mockResolvedValue(new Map());
  repo.findByClientId.mockResolvedValue(null);
  repo.append.mockResolvedValue(msg());
  notifications.notifyAgent.mockResolvedValue(true);
});

describe("send", () => {
  const input = { clientId: "c1", text: "hello" };

  it("stores the message with the sender, text and an inbox preview", async () => {
    const result = await service.send(owner, uid(10), input);
    expect(result.created).toBe(true);
    expect(result.message).toMatchObject({ id: uid(50), sequenceNumber: "5", senderType: "AGENT", status: "SENT" });
    expect(repo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        senderType: "AGENT",
        senderId: uid(1),
        clientId: "c1",
        content: "hello",
        preview: "hello",
      }),
    );
  });

  it("announces a new message to everyone except the sending socket, and not again on a retry", async () => {
    await service.send(owner, uid(10), input, "conn-1");
    expect(realtime.messageCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: uid(50), conversationId: uid(10) }),
      {
        conversationUpdated: true,
        origin: "conn-1",
      },
    );
    realtime.messageCreated.mockClear();
    repo.findByClientId.mockResolvedValue(msg());
    await service.send(owner, uid(10), input, "conn-1");
    expect(realtime.messageCreated).not.toHaveBeenCalled();
  });

  it("returns the original message on a retry instead of inserting again", async () => {
    repo.findByClientId.mockResolvedValue(msg());
    const result = await service.send(owner, uid(10), input);
    expect(result.created).toBe(false);
    expect(repo.append).not.toHaveBeenCalled();
  });

  it("refuses a clientId that belongs to someone else's message", async () => {
    repo.findByClientId.mockResolvedValue(msg({ senderId: uid(9) }));
    await expect(service.send(owner, uid(10), input)).rejects.toBeInstanceOf(ConflictError);
  });

  it("is 403 for a non-owner who can see the chat, and 404 when it is hidden", async () => {
    repo.lock.mockResolvedValue(conv({ handoffStatus: "NEEDS_HUMAN", assignedAgentId: null }));
    await expect(service.send(other, uid(10), input)).rejects.toBeInstanceOf(ForbiddenError);
    repo.lock.mockResolvedValue(conv());
    await expect(service.send(other, uid(10), input)).rejects.toBeInstanceOf(NotFoundError);
    repo.lock.mockResolvedValue(null);
    await expect(service.send(owner, uid(10), input)).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.append).not.toHaveBeenCalled();
  });

  it("refuses closed and archived conversations", async () => {
    repo.lock.mockResolvedValue(conv({ status: "CLOSED" }));
    await expect(service.send(owner, uid(10), input)).rejects.toBeInstanceOf(ForbiddenError);
    repo.lock.mockResolvedValue(conv({ isArchived: true }));
    await expect(service.send(owner, uid(10), input)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requires a reply target from the same conversation", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.send(owner, uid(10), { ...input, replyToMessageId: uid(3) })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    repo.findById.mockResolvedValue(msg({ id: uid(3) }));
    await service.send(owner, uid(10), { ...input, replyToMessageId: uid(3) });
    expect(repo.append).toHaveBeenCalledWith(expect.objectContaining({ replyToMessageId: uid(3) }));
  });

  it("cuts the preview by characters, never inside a surrogate pair", async () => {
    await service.send(owner, uid(10), { clientId: "c", text: "😀".repeat(300) });
    const preview = repo.append.mock.calls[0]?.[0].preview as string;
    expect(Array.from(preview)).toHaveLength(255);
    expect(preview.endsWith("😀")).toBe(true);
  });
});

describe("receiveFromCustomer", () => {
  const input = { customerId: uid(100), conversationId: uid(10), clientId: "cc1", text: "help" };

  it("stores the message and notifies the owning agent", async () => {
    repo.append.mockResolvedValue(msg({ senderType: "CUSTOMER", senderId: uid(100), clientId: "cc1" }));
    const result = await service.receiveFromCustomer(input);
    expect(result.created).toBe(true);
    expect(repo.reopen).not.toHaveBeenCalled();
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: uid(1), type: "NEW_MESSAGE", conversationId: uid(10), messageId: uid(50) }),
    );
  });

  it("reopens a resolved conversation and records why", async () => {
    repo.lock.mockResolvedValue(conv({ status: "RESOLVED", handoffStatus: "NONE", assignedAgentId: null }));
    await service.receiveFromCustomer(input);
    expect(repo.reopen).toHaveBeenCalledWith(uid(10));
    expect(repo.addActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "CUSTOMER",
        metadata: expect.objectContaining({ reason: "customer_message" }),
      }),
    );
    expect(notifications.notifyAgent).not.toHaveBeenCalled(); // nobody owns it
  });

  it("is idempotent, and rejects another customer's conversation", async () => {
    repo.findByClientId.mockResolvedValue(msg({ senderType: "CUSTOMER", senderId: uid(100) }));
    expect((await service.receiveFromCustomer(input)).created).toBe(false);
    expect(notifications.notifyAgent).not.toHaveBeenCalled();
    await expect(service.receiveFromCustomer({ ...input, customerId: uid(999) })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("announces the customer message to viewers of the conversation", async () => {
    repo.append.mockResolvedValue(msg({ senderType: "CUSTOMER", senderId: uid(100) }));
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
    await service.post(uid(10), "Agent 1 took over", { event: "takeover" });
    expect(realtime.messageCreated).toHaveBeenCalledWith(expect.objectContaining({ id: uid(50) }));
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
    await service.post(uid(10), "x");
    expect(repo.append).not.toHaveBeenCalled();
  });
});

describe("history", () => {
  it("returns messages with cursor metadata after an access check", async () => {
    repo.history.mockResolvedValue({
      items: [msg({ sequenceNumber: 4n }), msg({ sequenceNumber: 5n })],
      hasMore: true,
    });
    const result = await service.history(owner, uid(10), { limit: 2 });
    expect(result.meta).toEqual({
      limit: 2,
      hasMore: true,
      direction: "older",
      oldestSequence: "4",
      newestSequence: "5",
    });
    const sync = await service.history(owner, uid(10), { limit: 2, after: 3n });
    expect(sync.meta.direction).toBe("newer");
  });

  it("keeps a deleted message in place as a placeholder without its text, files or reactions", async () => {
    const deletedAt = new Date("2026-01-02T00:00:00Z");
    const deleted = msg({ content: "secret", metadata: { x: 1 } as never, deletedAt, deletedBy: uid(1) });
    repo.history.mockResolvedValue({ items: [deleted], hasMore: false });
    repo.reactionsFor.mockResolvedValue(
      new Map([[uid(50), [{ id: uid(60), userType: "AGENT", userId: uid(1), emoji: "👍", createdAt: at }]]]),
    );

    const [item] = (await service.history(owner, uid(10), { limit: 5 })).items;

    expect(item).toMatchObject({
      id: uid(50),
      sequenceNumber: "5",
      content: null,
      metadata: null,
      reactions: [],
      attachments: [],
      deletedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("marks live messages as not deleted", async () => {
    repo.history.mockResolvedValue({ items: [msg({ deletedAt: null })], hasMore: false });
    const [item] = (await service.history(owner, uid(10), { limit: 5 })).items;
    expect(item).toMatchObject({ content: "hello", deletedAt: null });
  });

  it("hides inaccessible conversations", async () => {
    await expect(service.history(other, uid(10), { limit: 5 })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.history).not.toHaveBeenCalled();
  });

  it("returns empty metadata for an empty conversation", async () => {
    repo.history.mockResolvedValue({ items: [], hasMore: false });
    expect((await service.history(owner, uid(10), { limit: 5 })).meta).toMatchObject({
      oldestSequence: null,
      newestSequence: null,
    });
  });
});

describe("markRead", () => {
  beforeEach(() => {
    repo.latest.mockResolvedValue(msg({ id: uid(9), sequenceNumber: 9n }));
    repo.readPosition.mockResolvedValue(4n);
    repo.unreadState.mockResolvedValue({ position: 9n, unread: 0, markedUnread: false });
    repo.receiptReadRange.mockResolvedValue([uid(60), uid(61)]);
  });

  it("advances to the latest message and records receipts for the newly read range", async () => {
    const state = await service.markRead(owner, uid(10));
    expect(repo.advanceRead).toHaveBeenCalledWith(uid(10), uid(1), 9n, uid(9));
    expect(repo.receiptReadRange).toHaveBeenCalledWith(uid(10), uid(1), 4n, 9n);
    expect(state).toEqual({
      conversationId: uid(10),
      lastReadSequenceNumber: "9",
      markedUnread: false,
      unreadCount: 0,
    });
    expect(realtime.readState).toHaveBeenCalledWith(uid(1), state); // the agent's other tabs
    expect(realtime.messageStatus).toHaveBeenCalledWith(uid(10), [uid(60), uid(61)], "READ");
  });

  it("does not create receipts when nothing new was read (an older tab)", async () => {
    repo.findById.mockResolvedValue(msg({ id: uid(3), sequenceNumber: 3n }));
    await service.markRead(owner, uid(10), uid(3));
    expect(repo.receiptReadRange).not.toHaveBeenCalled();
    expect(realtime.messageStatus).toHaveBeenCalledWith(uid(10), [], "READ"); // nothing newly read: the notifier ignores it
  });

  it("404s for a message outside the conversation, and does nothing for an empty one", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.markRead(owner, uid(10), uid(77))).rejects.toBeInstanceOf(NotFoundError);
    repo.latest.mockResolvedValue(null);
    await service.markRead(owner, uid(10));
    expect(repo.advanceRead).not.toHaveBeenCalled();
  });

  it("is hidden from agents who cannot see the conversation", async () => {
    await expect(service.markRead(other, uid(10))).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.advanceRead).not.toHaveBeenCalled();
  });
});

describe("markUnread / markDelivered", () => {
  it("flags unread, keeps the read position, and reports at least one unread", async () => {
    repo.unreadState.mockResolvedValue({ position: 8n, unread: 0, markedUnread: true });
    const state = await service.markUnread(owner, uid(10));
    expect(repo.markUnread).toHaveBeenCalledWith(uid(10), uid(1));
    expect(state).toMatchObject({ markedUnread: true, unreadCount: 1 });
  });

  it("records delivery only for the caller and only for customer messages", async () => {
    repo.findById.mockResolvedValue(msg({ senderType: "CUSTOMER", senderId: uid(100) }));
    await service.markDelivered(owner, uid(10), uid(50));
    expect(repo.receiptDelivered).toHaveBeenCalledWith(uid(50), uid(1));
    expect(realtime.messageStatus).not.toHaveBeenCalled(); // status did not advance (mock returns undefined)
    repo.findById.mockResolvedValue(msg({ senderType: "AGENT" }));
    await expect(service.markDelivered(owner, uid(10), uid(50))).rejects.toBeInstanceOf(BadRequestError);
    repo.findById.mockResolvedValue(null);
    await expect(service.markDelivered(owner, uid(10), uid(50))).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.markDelivered(other, uid(10), uid(50))).rejects.toBeInstanceOf(NotFoundError); // hidden chat
  });
});

describe("receiveFileFromCustomer", () => {
  const input = {
    customerId: uid(100),
    conversationId: uid(10),
    clientId: "cf1",
    messageType: "IMAGE",
    preview: "Photo: a.png",
    attachment: {
      storageKey: "k",
      fileName: "a.png",
      mimeType: "image/png",
      fileSize: 3,
      checksumSha256: "0".repeat(64),
    },
  };
  const stored = () => msg({ senderType: "CUSTOMER", senderId: uid(100), clientId: "cf1", messageType: "IMAGE" });

  it("stores a CUSTOMER message with the file attributed to the customer, and notifies the owner", async () => {
    repo.append.mockResolvedValue(stored());
    repo.addAttachment.mockResolvedValue({
      id: uid(60),
      conversationId: uid(10),
      uploadedByType: "CUSTOMER",
      uploadedById: uid(100),
      fileName: "a.png",
      mimeType: "image/png",
      fileSize: 3n,
      durationMs: null,
      waveform: null,
      createdAt: at,
    });
    const result = await service.receiveFileFromCustomer(input);
    expect(result.created).toBe(true);
    expect(result.message.attachments).toHaveLength(1);
    expect(repo.append).toHaveBeenCalledWith(
      expect.objectContaining({ senderType: "CUSTOMER", senderId: uid(100), preview: "Photo: a.png" }),
    );
    expect(repo.addAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ uploadedByType: "CUSTOMER", uploadedById: uid(100), messageId: uid(50) }),
    );
    expect(notifications.notifyAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: uid(1) }));
    expect(realtime.messageCreated).toHaveBeenCalled();
  });

  it("refuses a blocked customer before touching the database", async () => {
    guard.isBlocked.mockResolvedValue(true);
    await expect(service.receiveFileFromCustomer(input)).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.inTransaction).not.toHaveBeenCalled();
  });

  it("is idempotent, and rejects another customer's conversation", async () => {
    repo.findByClientId.mockResolvedValue(stored());
    repo.attachmentsFor.mockResolvedValue(new Map());
    expect((await service.receiveFileFromCustomer(input)).created).toBe(false);
    expect(repo.addAttachment).not.toHaveBeenCalled();
    expect(realtime.messageCreated).not.toHaveBeenCalled();
    await expect(service.receiveFileFromCustomer({ ...input, customerId: uid(999) })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("historyForCustomer", () => {
  it("leaves SYSTEM messages out and never sends metadata", async () => {
    repo.history.mockResolvedValue({ items: [msg({ metadata: { agentId: uid(1) } as never })], hasMore: false });
    repo.reactionsFor.mockResolvedValue(new Map());
    repo.attachmentsFor.mockResolvedValue(new Map());
    const result = await service.historyForCustomer(uid(10), { limit: 10 });
    expect(repo.history).toHaveBeenCalledWith(uid(10), { limit: 10 }, { excludeSystem: true });
    expect(result.items[0]?.metadata).toBeNull();
  });
});
