import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import { MessageActionService } from "../message-action.service.js";
import type { MessageRepository } from "../message.repository.js";
import type { MessageService } from "../message.service.js";
import type { LockedConversation, MessageRow, ReactionRow } from "../message.types.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const repo = {
  inTransaction: vi.fn(),
  findAnyById: vi.fn(),
  lock: vi.fn(),
  isViewer: vi.fn(),
  findByClientId: vi.fn(),
  append: vi.fn(),
  applyEdit: vi.fn(),
  listEditHistory: vi.fn(),
  softDelete: vi.fn(),
  previewSource: vi.fn(),
  setPreview: vi.fn(),
  reactionsFor: vi.fn(),
  addReaction: vi.fn(),
  findReaction: vi.fn(),
  deleteReaction: vi.fn(),
};
const messages = { send: vi.fn() };
const realtime = fakeRealtime();
const service = new MessageActionService(
  fromPartial<MessageRepository>(repo),
  fromPartial<MessageService>(messages),
  realtime,
);

const owner: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
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
    deletedAt: null,
    createdAt: at,
    ...patch,
  });
const reaction = (patch: Partial<ReactionRow> = {}): ReactionRow =>
  fromPartial<ReactionRow>({
    id: uid(70),
    messageId: uid(50),
    userType: "AGENT",
    userId: uid(1),
    emoji: "👍",
    createdAt: at,
    ...patch,
  });

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  repo.findAnyById.mockResolvedValue(msg());
  repo.lock.mockImplementation(async (id: string) => conv({ id }));
  repo.isViewer.mockResolvedValue(false);
  repo.reactionsFor.mockResolvedValue(new Map());
  repo.previewSource.mockResolvedValue(msg());
  repo.applyEdit.mockImplementation(async (m: MessageRow, _by: string, content: string) =>
    msg({ ...m, content, isEdited: true, editedAt: at }),
  );
  repo.softDelete.mockImplementation(async (id: string) => msg({ id, deletedAt: at }));
});

describe("access", () => {
  it("reports unknown, deleted and hidden messages the same way", async () => {
    repo.findAnyById.mockResolvedValue(null);
    await expect(service.edit(owner, uid(50), { text: "x" })).rejects.toThrow("Message not found");
    repo.findAnyById.mockResolvedValue(msg({ deletedAt: at }));
    await expect(service.edit(owner, uid(50), { text: "x" })).rejects.toThrow("Message not found");
    repo.findAnyById.mockResolvedValue(msg());
    await expect(service.edit(other, uid(50), { text: "x" })).rejects.toBeInstanceOf(NotFoundError); // someone else's chat
    await expect(service.react(other, uid(50), { emoji: "👍" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.remove(other, uid(50))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("reply", () => {
  it("sends through the normal send path with the original as reply target", async () => {
    messages.send.mockResolvedValue({ message: { id: uid(60) }, created: true });
    await service.reply(owner, uid(50), { clientId: "r1", text: "ok" });
    expect(messages.send).toHaveBeenCalledWith(owner, uid(10), {
      clientId: "r1",
      text: "ok",
      replyToMessageId: uid(50),
    });
  });

  it("does not reply to a message the caller cannot see", async () => {
    await expect(service.reply(other, uid(50), { clientId: "r1", text: "ok" })).rejects.toBeInstanceOf(NotFoundError);
    expect(messages.send).not.toHaveBeenCalled();
  });
});

describe("edit", () => {
  it("keeps the old text in the history and announces the update", async () => {
    const dto = await service.edit(owner, uid(50), { text: "hello there" });
    expect(repo.applyEdit).toHaveBeenCalledWith(expect.objectContaining({ content: "hello" }), uid(1), "hello there");
    expect(dto).toMatchObject({ content: "hello there", isEdited: true, editedAt: at.toISOString() });
    expect(realtime.messageEvent).toHaveBeenCalledWith(
      uid(10),
      "message.updated",
      { message: dto },
      { conversationUpdated: true },
    );
  });

  it("updates the inbox preview only when the newest message was edited", async () => {
    repo.previewSource.mockResolvedValue(msg({ id: uid(51), content: "newer" }));
    await service.edit(owner, uid(50), { text: "changed" });
    expect(repo.setPreview).not.toHaveBeenCalled();
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "message.updated", expect.anything(), {
      conversationUpdated: false,
    });
  });

  it("refuses other people's messages, other message types, and conversations the caller no longer owns", async () => {
    repo.findAnyById.mockResolvedValue(msg({ senderId: uid(2) }));
    await expect(service.edit(owner, uid(50), { text: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    repo.findAnyById.mockResolvedValue(msg({ senderType: "CUSTOMER", senderId: uid(100) }));
    await expect(service.edit(owner, uid(50), { text: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    repo.findAnyById.mockResolvedValue(msg({ messageType: "VOICE" }));
    await expect(service.edit(owner, uid(50), { text: "x" })).rejects.toBeInstanceOf(BadRequestError);
    repo.findAnyById.mockResolvedValue(msg());
    repo.lock.mockResolvedValue(conv({ status: "CLOSED" }));
    await expect(service.edit(owner, uid(50), { text: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.applyEdit).not.toHaveBeenCalled();
  });

  it("does nothing when the text is unchanged", async () => {
    await service.edit(owner, uid(50), { text: "hello" });
    expect(repo.applyEdit).not.toHaveBeenCalled();
  });

  it("a supervisor cannot edit an agent's message", async () => {
    await expect(service.edit(supervisor, uid(50), { text: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("remove", () => {
  it("lets the author soft-delete their message, records who, and announces it", async () => {
    const result = await service.remove(owner, uid(50));
    expect(repo.softDelete).toHaveBeenCalledWith(uid(50), uid(1));
    expect(result).toEqual({ id: uid(50), conversationId: uid(10), deletedAt: at.toISOString(), deletedBy: uid(1) });
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "message.deleted", result, expect.anything());
  });

  it("empties the preview when the last previewable message is deleted", async () => {
    repo.previewSource.mockResolvedValue(null);
    await service.remove(owner, uid(50));
    expect(repo.setPreview).toHaveBeenCalledWith(uid(10), null);
  });

  it("lets a supervisor delete a customer message but never a system message", async () => {
    repo.findAnyById.mockResolvedValue(msg({ senderType: "CUSTOMER", senderId: uid(100) }));
    await expect(service.remove(supervisor, uid(50))).resolves.toMatchObject({ deletedBy: uid(9) });
    repo.findAnyById.mockResolvedValue(msg({ senderType: "SYSTEM", senderId: null }));
    await expect(service.remove(supervisor, uid(50))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an agent deleting a customer message or a colleague's message they can see", async () => {
    repo.findAnyById.mockResolvedValue(msg({ senderType: "CUSTOMER", senderId: uid(100) }));
    await expect(service.remove(owner, uid(50))).rejects.toBeInstanceOf(ForbiddenError);
    repo.findAnyById.mockResolvedValue(msg({ senderId: uid(3) }));
    await expect(service.remove(owner, uid(50))).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.softDelete).not.toHaveBeenCalled();
  });
});

describe("history", () => {
  const edit = { id: uid(80), editorType: "AGENT", editorId: uid(1), previousContent: "old", editedAt: at };

  it("shows the edit trail to the author and to supervisors only", async () => {
    repo.listEditHistory.mockResolvedValue([edit]);
    const own = await service.history(owner, uid(50));
    expect(own.edits).toEqual([{ ...edit, editedAt: at.toISOString() }]);
    await expect(service.history(supervisor, uid(50))).resolves.toBeTruthy();
    repo.findAnyById.mockResolvedValue(msg({ senderId: uid(3) }));
    await expect(service.history(owner, uid(50))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps a deleted message's history from non-supervisors but not from supervisors", async () => {
    repo.listEditHistory.mockResolvedValue([]);
    repo.findAnyById.mockResolvedValue(msg({ deletedAt: at }));
    await expect(service.history(owner, uid(50))).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.history(supervisor, uid(50))).resolves.toMatchObject({ messageId: uid(50) });
  });
});

describe("reactions", () => {
  it("adds a reaction and broadcasts the full list", async () => {
    repo.addReaction.mockResolvedValue(reaction());
    repo.reactionsFor.mockResolvedValue(new Map([[uid(50), [reaction()]]]));
    // reactionsFor is read twice: once for the limit check (already empty on first call), then for the broadcast.
    repo.reactionsFor.mockResolvedValueOnce(new Map());
    const result = await service.react(owner, uid(50), { emoji: "👍" });
    expect(repo.addReaction).toHaveBeenCalledWith(uid(50), uid(1), "👍");
    expect(result.reactions).toHaveLength(1);
    expect(realtime.messageEvent).toHaveBeenCalledWith(
      uid(10),
      "message.reaction_updated",
      { conversationId: uid(10), messageId: uid(50), reactions: result.reactions },
      expect.anything(),
    );
  });

  it("is idempotent for the same emoji even at the per-user limit, and caps distinct emojis", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => reaction({ id: uid(100 + i), emoji: `e${i}` }));
    repo.reactionsFor.mockResolvedValue(new Map([[uid(50), ten]]));
    repo.addReaction.mockResolvedValue(ten[0]);
    await expect(service.react(owner, uid(50), { emoji: "e0" })).resolves.toBeTruthy();
    await expect(service.react(owner, uid(50), { emoji: "🔥" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("does not allow reacting to system messages", async () => {
    repo.findAnyById.mockResolvedValue(msg({ senderType: "SYSTEM", senderId: null }));
    await expect(service.react(owner, uid(50), { emoji: "👍" })).rejects.toBeInstanceOf(BadRequestError);
  });

  it("removes only the caller's own reaction", async () => {
    repo.findReaction.mockResolvedValue(reaction({ userId: uid(1) }));
    await service.unreact(owner, uid(50), uid(70));
    expect(repo.deleteReaction).toHaveBeenCalledWith(uid(70));

    repo.deleteReaction.mockClear();
    repo.findReaction.mockResolvedValue(reaction({ userId: uid(3) }));
    await expect(service.unreact(owner, uid(50), uid(70))).rejects.toBeInstanceOf(ForbiddenError);
    repo.findReaction.mockResolvedValue(reaction({ messageId: uid(51) })); // belongs to another message
    await expect(service.unreact(owner, uid(50), uid(70))).rejects.toBeInstanceOf(NotFoundError);
    repo.findReaction.mockResolvedValue(null);
    await expect(service.unreact(owner, uid(50), uid(70))).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.deleteReaction).not.toHaveBeenCalled();
  });
});

describe("forward", () => {
  const input = { targetConversationId: uid(11), clientId: "f1" };
  const target = (patch: Partial<LockedConversation> = {}) =>
    repo.lock.mockImplementation(async (id: string) => (id === uid(11) ? conv({ id, ...patch }) : conv({ id })));

  beforeEach(() => {
    repo.findByClientId.mockResolvedValue(null);
    repo.append.mockImplementation(async (input: { conversationId: string; content: string }) =>
      msg({
        id: uid(60),
        conversationId: input.conversationId,
        content: input.content,
        forwardedFromMessageId: uid(50),
      }),
    );
  });

  it("copies the text into the target and keeps a reference to the original", async () => {
    target();
    const { message, created } = await service.forward(owner, uid(50), input);
    expect(created).toBe(true);
    expect(message).toMatchObject({ conversationId: uid(11), forwardedFromMessageId: uid(50) });
    expect(repo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: uid(11),
        senderType: "AGENT",
        senderId: uid(1),
        content: "hello",
        forwardedFromMessageId: uid(50),
        metadata: { forwardedFrom: expect.objectContaining({ conversationId: uid(10), messageId: uid(50) }) },
      }),
    );
    expect(realtime.messageCreated).toHaveBeenCalled();
    expect(realtime.messageEvent).toHaveBeenCalledWith(
      uid(11),
      "message.forwarded",
      expect.objectContaining({ forwardedFrom: { conversationId: uid(10), messageId: uid(50) } }),
      expect.anything(),
    );
  });

  it("locks both conversations in a fixed order", async () => {
    target();
    await service.forward(owner, uid(50), { ...input, targetConversationId: uid(5) });
    expect(repo.lock.mock.calls.map(([id]) => id)).toEqual([uid(5), uid(10)]);
  });

  it("never copies one customer's message into another customer's conversation", async () => {
    target({ customerId: uid(200) });
    await expect(service.forward(owner, uid(50), input)).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.append).not.toHaveBeenCalled();
  });

  it("allows an internal target even for a different customer", async () => {
    target({ customerId: null, conversationType: "INTERNAL" });
    await expect(service.forward(owner, uid(50), input)).resolves.toMatchObject({ created: true });
  });

  it("needs a target the caller owns and that is open, and hides targets they cannot see", async () => {
    target({ status: "CLOSED" });
    await expect(service.forward(owner, uid(50), input)).rejects.toBeInstanceOf(ForbiddenError);
    target({ assignedAgentId: uid(2) });
    await expect(service.forward(owner, uid(50), input)).rejects.toBeInstanceOf(NotFoundError);
    repo.lock.mockImplementation(async (id: string) => (id === uid(11) ? null : conv({ id })));
    await expect(service.forward(owner, uid(50), input)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses system, deleted and non-text sources", async () => {
    target();
    repo.findAnyById.mockResolvedValue(msg({ senderType: "SYSTEM", senderId: null }));
    await expect(service.forward(owner, uid(50), input)).rejects.toBeInstanceOf(BadRequestError);
    repo.findAnyById.mockResolvedValue(msg({ messageType: "IMAGE", content: null }));
    await expect(service.forward(owner, uid(50), input)).rejects.toBeInstanceOf(BadRequestError);
    repo.findAnyById.mockResolvedValue(msg({ deletedAt: at }));
    await expect(service.forward(owner, uid(50), input)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns the original copy on a retry and rejects a clientId used for something else", async () => {
    target();
    repo.findByClientId.mockResolvedValue(msg({ id: uid(60), senderId: uid(1), forwardedFromMessageId: uid(50) }));
    await expect(service.forward(owner, uid(50), input)).resolves.toMatchObject({ created: false });
    expect(repo.append).not.toHaveBeenCalled();
    expect(realtime.messageEvent).not.toHaveBeenCalled();
    repo.findByClientId.mockResolvedValue(msg({ id: uid(61), forwardedFromMessageId: null }));
    await expect(service.forward(owner, uid(50), input)).rejects.toBeInstanceOf(ConflictError);
  });
});
