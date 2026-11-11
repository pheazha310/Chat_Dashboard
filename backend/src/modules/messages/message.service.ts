import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { canView, permissionsFor } from "@shared/policy/conversation-access.js";
import type { AutoResponder, AutomaticMessagePort } from "@shared/ports/auto-response.js";
import type { CustomerGuard, MessageLookup } from "@shared/ports/moderation.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import type { SystemMessagePort } from "@shared/ports/system-message.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import type { CursorQuery } from "@shared/utils/pagination.js";
import type { NotificationService } from "@modules/notifications/index.js";
import type { MessageRepository, NewAttachment } from "./message.repository.js";
import type { SearchAllQuery, SearchQuery, SendInput } from "./message.schema.js";
import { toAttachment, toMessage, toPin } from "./message.mapper.js";
import type { LockedConversation, MessageRow, PinDto, ReadState } from "./message.types.js";

const PREVIEW_LENGTH = 255;
/** Cut by code points: a split surrogate pair would be rejected by PostgreSQL. */
const toPreview = (text: string) => Array.from(text).slice(0, PREVIEW_LENGTH).join("");

export class MessageService implements SystemMessagePort, AutomaticMessagePort, MessageLookup {
  constructor(
    private readonly repository: MessageRepository,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeNotifier,
    /** Moderation, built after this service, hence a function. Absent in tests that do not need it. */
    private readonly guard?: () => CustomerGuard,
    /** The automatic replies, built after this service, hence a function. Absent in tests that do not need it. */
    private readonly autoResponder?: () => AutoResponder,
  ) {}

  async existsInConversation(conversationId: string, messageId: string): Promise<boolean> {
    return (await this.repository.findById(conversationId, messageId)) !== null;
  }

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
   * An agent sends a file or voice message. The bytes are already in storage; this stores the message and the file's
   * metadata together or not at all. Same rules and the same `clientId` idempotency as `send`. A retry returns the
   * original message with `created: false`, and the caller must then discard the file it just stored.
   */
  async sendWithAttachment(
    auth: AuthContext,
    conversationId: string,
    input: {
      clientId: string;
      text?: string | undefined;
      messageType: string;
      /** What the inbox shows when there is no caption. */
      preview: string;
      attachment: NewAttachment;
    },
  ) {
    const result = await this.repository.inTransaction(async (tx) => {
      const conversation = await this.lockVisible(tx, auth, conversationId);
      const existing = await tx.findByClientId(conversationId, input.clientId);
      if (existing) {
        if (existing.senderType !== "AGENT" || existing.senderId !== auth.userId) {
          throw new ConflictError("clientId is already used by another message");
        }
        const files = (await tx.attachmentsFor([existing.id])).get(existing.id) ?? [];
        return {
          message: toMessage(
            existing,
            [],
            files.map((row) => toAttachment(row, existing.id)),
          ),
          created: false,
        };
      }
      if (!permissionsFor(auth, conversation).canSendMessage) {
        throw new ForbiddenError("Only the agent who owns an open conversation can send messages");
      }
      const message = await tx.append({
        conversationId,
        clientId: input.clientId,
        senderType: "AGENT",
        senderId: auth.userId,
        messageType: input.messageType,
        content: input.text ?? null,
        preview: toPreview(input.text || input.preview),
      });
      const file = await tx.addAttachment({
        ...input.attachment,
        conversationId,
        messageId: message.id,
        uploadedById: auth.userId,
      });
      return { message: toMessage(message, [], [toAttachment(file, message.id)]), created: true };
    });
    if (result.created) {
      await bestEffort("realtime", () => this.realtime.messageCreated(result.message, { conversationUpdated: true }));
    }
    return result;
  }

  /**
   * A message that contains a blocked keyword is kept (a legitimate question must not be lost) and flagged: a
   * `MODERATION` timeline entry and a `message.flagged` event to whoever can see the conversation. The keyword list is
   * not repeated in either, only how many matched.
   */
  private async flagIfNeeded(conversationId: string, messageId: string, text: string) {
    await bestEffort("keyword check", async () => {
      const matched = await this.guard?.().matchedKeywords(text);
      if (!matched || matched.length === 0) return;
      await this.repository.addActivity({
        conversationId,
        actorType: "SYSTEM",
        activityType: "MODERATION",
        description: "Message matched a blocked keyword",
        metadata: { messageId, matches: matched.length },
      });
      await this.realtime.messageEvent(conversationId, "message.flagged", {
        conversationId,
        messageId,
        matches: matched.length,
      });
    });
  }

  /**
   * A customer text message. Used by the mobile customer API (`/api/v1/customer`). Reopens a
   * resolved or closed conversation and notifies the owning agent.
   */
  async receiveFromCustomer(input: {
    customerId: string;
    conversationId: string;
    clientId: string;
    text: string;
    /** The WebSocket connection that sent it, if any: it gets an ack instead of its own `message.new`. */
    origin?: string | undefined;
  }) {
    if (await this.guard?.().isBlocked(input.customerId)) throw new ForbiddenError("This customer is blocked");
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
      if (conversation.isArchived) await this.restoreArchived(tx, input.conversationId, input.customerId);
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
      await bestEffort("realtime", () =>
        this.realtime.messageCreated(dto, {
          conversationUpdated: true,
          ...(input.origin ? { origin: input.origin } : {}),
        }),
      );
      await this.flagIfNeeded(input.conversationId, dto.id, input.text);
      await this.letAutoRepliesReact(input.conversationId);
    }
    return { message: dto, created };
  }

  /** A customer message un-archives its conversation, so the agent sees it in the inbox again. */
  private async restoreArchived(tx: MessageRepository, conversationId: string, customerId: string) {
    await tx.restore(conversationId);
    await tx.addActivity({
      conversationId,
      actorType: "CUSTOMER",
      actorId: customerId,
      activityType: "RESTORED",
      description: "Restored by a new customer message",
      metadata: { reason: "customer_message" },
    });
  }

  /**
   * A customer sends a file or voice message (the bytes are already in storage). Same rules as `receiveFromCustomer`:
   * blocked customers are refused, a resolved or closed conversation is reopened, the owner is notified, and a retry
   * with the same `clientId` returns the original message with `created: false` (the caller then discards the file).
   */
  async receiveFileFromCustomer(input: {
    customerId: string;
    conversationId: string;
    clientId: string;
    text?: string | undefined;
    messageType: string;
    preview: string;
    attachment: NewAttachment;
  }) {
    if (await this.guard?.().isBlocked(input.customerId)) throw new ForbiddenError("This customer is blocked");
    const { message, attachments, created, owner } = await this.repository.inTransaction(async (tx) => {
      const conversation = await tx.lock(input.conversationId);
      if (!conversation || conversation.customerId !== input.customerId) {
        throw new NotFoundError("Conversation not found");
      }
      const existing = await tx.findByClientId(input.conversationId, input.clientId);
      if (existing) {
        if (existing.senderType !== "CUSTOMER" || existing.senderId !== input.customerId) {
          throw new ConflictError("clientId is already used by another message");
        }
        const files = (await tx.attachmentsFor([existing.id])).get(existing.id) ?? [];
        return { message: existing, attachments: files, created: false, owner: null };
      }
      const stored = await tx.append({
        conversationId: input.conversationId,
        clientId: input.clientId,
        senderType: "CUSTOMER",
        senderId: input.customerId,
        messageType: input.messageType,
        content: input.text ?? null,
        preview: toPreview(input.text || input.preview),
      });
      const file = await tx.addAttachment({
        ...input.attachment,
        conversationId: input.conversationId,
        messageId: stored.id,
        uploadedById: input.customerId,
        uploadedByType: "CUSTOMER",
      });
      if (conversation.isArchived) await this.restoreArchived(tx, input.conversationId, input.customerId);
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
      return { message: stored, attachments: [file], created: true, owner: conversation.assignedAgentId };
    });

    const dto = toMessage(
      message,
      [],
      attachments.map((row) => toAttachment(row, message.id)),
    );
    if (created) {
      if (owner !== null) {
        await bestEffort("new-message notification", async () => {
          await this.notifications.notifyAgent({
            agentId: owner,
            type: "NEW_MESSAGE",
            title: "New message",
            body: toPreview(input.text || input.preview),
            conversationId: input.conversationId,
            messageId: message.id,
          });
        });
      }
      await bestEffort("realtime", () => this.realtime.messageCreated(dto, { conversationUpdated: true }));
      if (input.text) await this.flagIfNeeded(input.conversationId, dto.id, input.text);
      await this.letAutoRepliesReact(input.conversationId);
    }
    return { message: dto, created };
  }

  /** After a new customer message: the away message may be due. Never fails the customer's own request. */
  private async letAutoRepliesReact(conversationId: string) {
    await bestEffort("automatic reply", async () => {
      await this.autoResponder?.().customerMessaged(conversationId);
    });
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
   * An automatic reply (first response, away message). An ASSISTANT message, so the customer sees it (SYSTEM messages
   * are internal), marked `automatic` in its metadata. Like a SYSTEM message it does not change the inbox preview or
   * last-activity time: an automatic text must not look like an agent answered.
   */
  async postAutomatic(conversationId: string, text: string, metadata: Record<string, unknown>) {
    const stored = await this.repository.inTransaction(async (tx) => {
      if (!(await tx.lock(conversationId))) return null;
      return tx.append({
        conversationId,
        clientId: null,
        senderType: "ASSISTANT",
        senderId: null,
        messageType: "TEXT",
        content: text,
        metadata: metadata as never,
        preview: null,
      });
    });
    if (!stored) return null;
    await bestEffort("realtime", () => this.realtime.messageCreated(toMessage(stored)));
    return stored.id;
  }

  /**
   * History, oldest to newest. No cursor returns the latest page; `before` pages back; `after` returns what was
   * missed since a known sequence number (reconnect sync). Soft-deleted messages are excluded.
   */
  async history(auth: AuthContext, conversationId: string, query: CursorQuery) {
    await this.requireVisible(auth, conversationId);
    return this.loadHistory(conversationId, query, false);
  }

  /**
   * History for the customer's own conversation (the caller has already proved ownership). Internal SYSTEM messages
   * (takeover, transfer, status changes) are left out and `metadata` is never sent.
   */
  async historyForCustomer(conversationId: string, query: CursorQuery) {
    const page = await this.loadHistory(conversationId, query, true);
    return { ...page, items: page.items.map((item) => ({ ...item, metadata: null })) };
  }

  private async loadHistory(conversationId: string, query: CursorQuery, excludeSystem: boolean) {
    const { items, hasMore } = await this.repository.history(conversationId, query, { excludeSystem });
    const ids = items.map((item) => item.id);
    const [reactions, attachments] = await Promise.all([
      this.repository.reactionsFor(ids),
      this.repository.attachmentsFor(ids),
    ]);
    return {
      items: items.map((item) =>
        toMessage(
          item,
          reactions.get(item.id),
          (attachments.get(item.id) ?? []).map((row) => toAttachment(row, item.id)),
        ),
      ),
      meta: {
        limit: query.limit,
        hasMore,
        direction: query.after === undefined && query.from === undefined ? "older" : "newer",
        oldestSequence: items[0] ? items[0].sequenceNumber.toString() : null,
        newestSequence: items.at(-1) ? items.at(-1)!.sequenceNumber.toString() : null,
      },
    };
  }

  /**
   * Text search in one conversation, newest match first. Each hit carries its `sequenceNumber`, so the client can
   * load the history around it with the normal cursors. Deleted and SYSTEM messages never match.
   */
  async search(auth: AuthContext, conversationId: string, query: SearchQuery) {
    await this.requireVisible(auth, conversationId);
    const rows = await this.repository.search(conversationId, query.q, query.limit + 1);
    return {
      items: rows.slice(0, query.limit).map((row) => toMessage(row)),
      meta: { limit: query.limit, hasMore: rows.length > query.limit },
    };
  }

  /** The pin bar: messages pinned in this conversation, newest pin first. Everyone who can see the chat sees them. */
  async listPins(auth: AuthContext, conversationId: string): Promise<PinDto[]> {
    await this.requireVisible(auth, conversationId);
    return (await this.repository.activePins(conversationId)).map(toPin);
  }

  /**
   * Search across every conversation the caller may open (the inbox search), newest first. Each word matches a whole
   * word or the start of one ("sal" finds "salary"), using the full-text index on message content.
   */
  async searchAll(auth: AuthContext, query: SearchAllQuery) {
    const words = (query.q.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).slice(0, 8);
    if (words.length === 0) return { items: [], meta: { limit: query.limit, hasMore: false } };
    const rows = await this.repository.searchAll(auth, words.map((word) => `${word}:*`).join(" & "), query.limit + 1);
    return {
      items: rows.slice(0, query.limit).map(({ conversation, ...row }) => ({ message: toMessage(row), conversation })),
      meta: { limit: query.limit, hasMore: rows.length > query.limit },
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
