import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { canView, permissionsFor } from "@shared/policy/conversation-access.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import type { SystemMessagePort } from "@shared/ports/system-message.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import type { CursorQuery } from "@shared/utils/pagination.js";
import type { NotificationService } from "@modules/notifications/index.js";
import type { MessageRepository } from "./message.repository.js";
import type { SendInput } from "./message.schema.js";
import type { LockedConversation, MessageDto, MessageRow, ReadState } from "./message.types.js";

const PREVIEW_LENGTH = 255;
/** Cut by code points: a split surrogate pair would be rejected by PostgreSQL. */
const toPreview = (text: string) => Array.from(text).slice(0, PREVIEW_LENGTH).join("");

export class MessageService implements SystemMessagePort {
  constructor(
    private readonly repository: MessageRepository,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeNotifier,
  ) {}

  /**
   * An agent sends a message. Safe to retry: the same `clientId` returns the original message (`created: false`)
   * instead of inserting a duplicate, even for simultaneous retries (the conversation row lock serializes them).
   * `origin` is the WebSocket connection that sent it, if any.
   */
  async send(auth: AuthContext, conversationId: string, input: SendInput, origin?: string) {
    const result = await this.repository.inTransaction(async (tx) => {
      const conversation = await this.lockVisible(tx, auth, conversationId);

      const existing = await tx.findByClientId(conversationId, input.clientId);
      if (existing) {
        if (existing.senderType !== "AGENT" || existing.senderId !== auth.userId) {
          throw new ConflictError("clientId is already used by another message");
        }
        return { message: toMessage(existing), created: false };
      }

      if (!permissionsFor(auth, conversation).canSendMessage) {
        throw new ForbiddenError("Only the agent who owns an open conversation can send messages");
      }
      if (input.replyToMessageId !== undefined && !(await tx.findById(conversationId, input.replyToMessageId))) {
        throw new BadRequestError("replyToMessageId does not belong to this conversation");
      }

      const message = await tx.append({
        conversationId,
        clientId: input.clientId,
        senderType: "AGENT",
        senderId: auth.userId,
        messageType: "TEXT",
        content: input.text,
        replyToMessageId: input.replyToMessageId ?? null,
        preview: toPreview(input.text),
      });
      return { message: toMessage(message), created: true };
    });
    if (result.created) {
      // `origin` is the socket that sent it: it gets an ack, everyone else (including its owner's other tabs) message.new.
      await bestEffort("realtime", () =>
        this.realtime.messageCreated(result.message, { conversationUpdated: true, ...(origin ? { origin } : {}) }),
      );
    }
    return result;
  }

  /**
   * A customer message. Used by the customer channel (not built yet; it needs its own authentication). Reopens a
   * resolved or closed conversation and notifies the owning agent.
   */
  async receiveFromCustomer(input: { customerId: string; conversationId: string; clientId: string; text: string }) {
    const { message, created, owner } = await this.repository.inTransaction(async (tx) => {
      const conversation = await tx.lock(input.conversationId);
      if (!conversation || conversation.customerId !== input.customerId) {
        throw new NotFoundError("Conversation not found");
      }
      const existing = await tx.findByClientId(input.conversationId, input.clientId);
      if (existing) {
        if (existing.senderType !== "CUSTOMER" || existing.senderId !== input.customerId) {
          throw new ConflictError("clientId is already used by another message");
        }
        return { message: existing, created: false, owner: null };
      }

      const stored = await tx.append({
        conversationId: input.conversationId,
        clientId: input.clientId,
        senderType: "CUSTOMER",
        senderId: input.customerId,
        messageType: "TEXT",
        content: input.text,
        preview: toPreview(input.text),
      });
      if (conversation.status !== "OPEN") {
        await tx.reopen(input.conversationId);
        await tx.addActivity({
          conversationId: input.conversationId,
          actorType: "CUSTOMER",
          actorId: input.customerId,
          activityType: "STATUS_CHANGED",
          description: `Reopened by a new customer message (was ${conversation.status})`,
          metadata: { from: conversation.status, to: "OPEN", reason: "customer_message" },
        });
      }
      return { message: stored, created: true, owner: conversation.assignedAgentId };
    });

    if (created && owner !== null) {
      await bestEffort("new-message notification", async () => {
        await this.notifications.notifyAgent({
          agentId: owner,
          type: "NEW_MESSAGE",
          title: "New message",
          body: toPreview(input.text),
          conversationId: input.conversationId,
          messageId: message.id,
        });
      });
    }
    const dto = toMessage(message);
    if (created) {
      await bestEffort("realtime", () => this.realtime.messageCreated(dto, { conversationUpdated: true }));
    }
    return { message: dto, created };
  }

  /** SYSTEM message (takeover, transfer, status change). Does not change the inbox preview or last-activity time. */
  async post(conversationId: string, text: string, metadata?: Record<string, unknown>) {
    const stored = await this.repository.inTransaction(async (tx) => {
      if (!(await tx.lock(conversationId))) return null;
      return tx.append({
        conversationId,
        clientId: null,
        senderType: "SYSTEM",
        senderId: null,
        messageType: "SYSTEM",
        content: text,
        ...(metadata === undefined ? {} : { metadata: metadata as never }),
        preview: null,
      });
    });
    if (stored) await bestEffort("realtime", () => this.realtime.messageCreated(toMessage(stored)));
  }

  /**
   * History, oldest to newest. No cursor returns the latest page; `before` pages back; `after` returns what was
   * missed since a known sequence number (reconnect sync). Soft-deleted messages are excluded.
   */
  async history(auth: AuthContext, conversationId: string, query: CursorQuery) {
    await this.requireVisible(auth, conversationId);
    const { items, hasMore } = await this.repository.history(conversationId, query);
    return {
      items: items.map(toMessage),
      meta: {
        limit: query.limit,
        hasMore,
        direction: query.after === undefined ? "older" : "newer",
        oldestSequence: items[0] ? items[0].sequenceNumber.toString() : null,
        newestSequence: items.at(-1) ? items.at(-1)!.sequenceNumber.toString() : null,
      },
    };
  }

  /**
   * The agent has the conversation open and up to date: move their read position (default: the latest message),
   * record receipts for the customer messages they just read, and clear "marked unread". The client must call this
   * only while the conversation is actually in view; the server never marks anything read on its own.
   */
  async markRead(auth: AuthContext, conversationId: string, upToMessageId?: string): Promise<ReadState> {
    await this.requireVisible(auth, conversationId);
    const nowRead = await this.repository.inTransaction(async (tx) => {
      const target =
        upToMessageId === undefined
          ? await tx.latest(conversationId)
          : await tx.findById(conversationId, upToMessageId);
      if (upToMessageId !== undefined && !target) throw new NotFoundError("Message not found in this conversation");
      if (!target) return []; // empty conversation: nothing to read
      const previous = await tx.readPosition(conversationId, auth.userId);
      await tx.advanceRead(conversationId, auth.userId, target.sequenceNumber, target.id);
      return target.sequenceNumber > previous
        ? tx.receiptReadRange(conversationId, auth.userId, previous, target.sequenceNumber)
        : [];
    });
    const state = await this.readState(auth, conversationId);
    // The agent's other sessions learn the new unread count; everyone who sees the chat learns which messages are READ.
    await bestEffort("realtime", () => this.realtime.readState(auth.userId, state));
    await bestEffort("realtime", () => this.realtime.messageStatus(conversationId, nowRead, "READ"));
    return state;
  }

  async markUnread(auth: AuthContext, conversationId: string): Promise<ReadState> {
    await this.repository.inTransaction(async (tx) => {
      const conversation = await this.lockVisible(tx, auth, conversationId);
      await tx.markUnread(conversation.id, auth.userId);
    });
    const state = await this.readState(auth, conversationId);
    await bestEffort("realtime", () => this.realtime.readState(auth.userId, state));
    return state;
  }

  /** The agent's client received a customer message. Agents can only record receipts for themselves. */
  async markDelivered(auth: AuthContext, conversationId: string, messageId: string) {
    await this.requireVisible(auth, conversationId);
    const message = await this.repository.findById(conversationId, messageId);
    if (!message) throw new NotFoundError("Message not found in this conversation");
    if (message.senderType !== "CUSTOMER") throw new BadRequestError("Only customer messages have agent receipts");
    const advanced = await this.repository.receiptDelivered(messageId, auth.userId);
    if (advanced) {
      await bestEffort("realtime", () => this.realtime.messageStatus(conversationId, [messageId], "DELIVERED"));
    }
    const updated = await this.repository.findById(conversationId, messageId);
    return toMessage(updated as MessageRow);
  }

  private async readState(auth: AuthContext, conversationId: string): Promise<ReadState> {
    const { position, unread, markedUnread } = await this.repository.unreadState(conversationId, auth.userId);
    return {
      conversationId: idToString(conversationId),
      lastReadSequenceNumber: position.toString(),
      markedUnread,
      unreadCount: markedUnread ? Math.max(1, unread) : unread,
    };
  }

  /** Locks the conversation and hides it (404) from callers who may not see it. */
  private async lockVisible(tx: MessageRepository, auth: AuthContext, id: string): Promise<LockedConversation> {
    const conversation = await tx.lock(id);
    if (!conversation || !canView(auth, conversation, await tx.isViewer(id, auth.userId))) {
      throw new NotFoundError(`Conversation ${idToString(id)} not found`);
    }
    return conversation;
  }

  private async requireVisible(auth: AuthContext, id: string) {
    await this.repository.inTransaction((tx) => this.lockVisible(tx, auth, id));
  }
}

// ─── DTO mapping ───────────────────────────────────────────────────────────

const toMessage = (row: MessageRow): MessageDto => ({
  id: idToString(row.id),
  conversationId: idToString(row.conversationId),
  clientId: row.clientId,
  sequenceNumber: row.sequenceNumber.toString(),
  senderType: row.senderType,
  senderId: row.senderId === null ? null : idToString(row.senderId),
  type: row.messageType,
  content: row.content,
  metadata: row.metadata,
  status: row.status,
  replyToMessageId: row.replyToMessageId === null ? null : idToString(row.replyToMessageId),
  createdAt: row.createdAt.toISOString(),
});
