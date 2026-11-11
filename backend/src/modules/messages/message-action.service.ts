import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { can } from "@shared/auth/permissions.js";
import { canView, permissionsFor } from "@shared/policy/conversation-access.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import {
  MAX_PINS,
  MAX_REACTIONS_PER_USER,
  type EditInput,
  type ForwardInput,
  type ReactionInput,
  type ReplyInput,
} from "./message-action.schema.js";
import { toEditEntry, toMessage, toPin, toReaction } from "./message.mapper.js";
import type { MessageRepository } from "./message.repository.js";
import type { MessageService } from "./message.service.js";
import type { LockedConversation, MessageHistoryDto, MessageRow, PinDto } from "./message.types.js";

const PREVIEW_LENGTH = 255;
const toPreview = (text: string) => Array.from(text).slice(0, PREVIEW_LENGTH).join("");

/**
 * What an agent can do with an existing message: reply, edit, delete, read the edit history, react and forward.
 * Messages are addressed by id alone, so every method first resolves the conversation and applies the same
 * visibility rule as REST (`canView`); a message the caller may not see is reported as not found.
 */
export class MessageActionService {
  constructor(
    private readonly repository: MessageRepository,
    private readonly messages: MessageService,
    private readonly realtime: RealtimeNotifier,
  ) {}

  /** A reply is a normal agent message pointing at the original, so it follows the same rules as sending. */
  async reply(auth: AuthContext, messageId: string, input: ReplyInput) {
    const original = await this.repository.inTransaction(
      async (tx) => (await this.loadVisible(tx, auth, messageId)).message,
    );
    return this.messages.send(auth, original.conversationId, {
      clientId: input.clientId,
      text: input.text,
      replyToMessageId: original.id,
    });
  }

  /**
   * Only the author may edit, and only while they could still send in the conversation (they own it and it is open).
   * The text being replaced is kept in `message_edit_history`.
   */
  async edit(auth: AuthContext, messageId: string, input: EditInput) {
    const { message, previewChanged } = await this.repository.inTransaction(async (tx) => {
      const { message, conversation } = await this.loadVisible(tx, auth, messageId);
      if (message.senderType !== "AGENT" || message.senderId !== auth.userId) {
        throw new ForbiddenError("You can only edit your own messages");
      }
      if (message.messageType !== "TEXT") throw new BadRequestError("Only text messages can be edited");
      if (!permissionsFor(auth, conversation).canSendMessage) {
        throw new ForbiddenError("Messages can only be edited in an open conversation you own");
      }
      if (message.content === input.text) return { message, previewChanged: false };

      const updated = await tx.applyEdit(message, auth.userId, input.text);
      return { message: updated, previewChanged: await this.refreshPreview(tx, updated) };
    });
    const dto = await this.withReactions(message);
    await this.publish(dto.conversationId, "message.updated", { message: dto }, previewChanged);
    return dto;
  }

  /**
   * Soft delete. Authors delete their own messages; supervisors and admins may delete any agent, AI or customer
   * message (moderation). SYSTEM messages are the audit trail and are never deleted.
   */
  async remove(auth: AuthContext, messageId: string) {
    const { message, previewChanged } = await this.repository.inTransaction(async (tx) => {
      const { message } = await this.loadVisible(tx, auth, messageId);
      if (message.senderType === "SYSTEM") throw new ForbiddenError("System messages cannot be deleted");
      const own = message.senderType === "AGENT" && message.senderId === auth.userId;
      if (!own && !can(auth, "messages.delete_any")) throw new ForbiddenError("You can only delete your own messages");

      const deleted = await tx.softDelete(message.id, auth.userId);
      return { message: deleted, previewChanged: await this.refreshPreview(tx, deleted) };
    });
    const result = {
      id: idToString(message.id),
      conversationId: idToString(message.conversationId),
      deletedAt: (message.deletedAt as Date).toISOString(),
      deletedBy: auth.userId,
    };
    await this.publish(result.conversationId, "message.deleted", result, previewChanged);
    return result;
  }

  /** Earlier versions of a message. Visible to its author and to supervisors, since old text may be sensitive. */
  async history(auth: AuthContext, messageId: string): Promise<MessageHistoryDto> {
    const message = await this.repository.inTransaction(
      async (tx) => (await this.loadVisible(tx, auth, messageId, true)).message,
    );
    const own = message.senderType === "AGENT" && message.senderId === auth.userId;
    if (!own && !can(auth, "messages.view_history_any"))
      throw new ForbiddenError("Only the author or a supervisor can see the edit history");
    if (message.deletedAt !== null && !can(auth, "messages.view_history_any"))
      throw new NotFoundError("Message not found");
    const edits = await this.repository.listEditHistory(message.id);
    return {
      messageId: idToString(message.id),
      conversationId: idToString(message.conversationId),
      currentContent: message.content,
      edits: edits.map(toEditEntry),
    };
  }

  /** Idempotent: reacting twice with the same emoji keeps one reaction (unique per user, message and emoji). */
  async react(auth: AuthContext, messageId: string, input: ReactionInput) {
    const message = await this.repository.inTransaction(async (tx) =>
      this.reactable(await this.loadVisible(tx, auth, messageId)),
    );
    const reactions = await this.repository.reactionsFor([message.id]);
    const mine = (reactions.get(message.id) ?? []).filter((r) => r.userType === "AGENT" && r.userId === auth.userId);
    if (!mine.some((r) => r.emoji === input.emoji) && mine.length >= MAX_REACTIONS_PER_USER) {
      throw new ConflictError(`You can add at most ${MAX_REACTIONS_PER_USER} different reactions to one message`);
    }
    const reaction = await this.repository.addReaction(message.id, auth.userId, input.emoji);
    const all = await this.announceReactions(message);
    return { reaction: toReaction(reaction), reactions: all };
  }

  /** Removes the caller's own reaction. */
  async unreact(auth: AuthContext, messageId: string, reactionId: string) {
    const message = await this.repository.inTransaction(async (tx) =>
      this.reactable(await this.loadVisible(tx, auth, messageId)),
    );
    const reaction = await this.repository.findReaction(reactionId);
    if (!reaction || reaction.messageId !== message.id) throw new NotFoundError("Reaction not found");
    if (reaction.userType !== "AGENT" || reaction.userId !== auth.userId) {
      throw new ForbiddenError("You can only remove your own reactions");
    }
    await this.repository.deleteReaction(reaction.id);
    return { reactions: await this.announceReactions(message) };
  }

  /**
   * Copies a text message into another conversation the caller can send in, keeping a reference to the original
   * (`forwardedFromMessageId`). The customer's words may only go to that same customer's conversations or to an
   * internal conversation, never into another customer's chat. Safe to retry with the same `clientId`.
   */
  async forward(auth: AuthContext, messageId: string, input: ForwardInput) {
    const result = await this.repository.inTransaction(async (tx) => {
      const found = await tx.findAnyById(messageId);
      if (!found) throw new NotFoundError("Message not found");
      // Both conversations are locked in id order, so two opposite forwards cannot deadlock each other.
      const ids = [...new Set([found.conversationId, input.targetConversationId])].sort();
      const locked = new Map<string, LockedConversation>();
      for (const id of ids) {
        const conversation = await tx.lock(id);
        if (conversation) locked.set(id, conversation);
      }
      const source = locked.get(found.conversationId);
      const target = locked.get(input.targetConversationId);
      const message = await tx.findAnyById(messageId);
      if (
        !source ||
        !message ||
        message.deletedAt !== null ||
        !canView(auth, source, await tx.isViewer(source.id, auth.userId))
      ) {
        throw new NotFoundError("Message not found");
      }
      if (!target || !canView(auth, target, await tx.isViewer(target.id, auth.userId))) {
        throw new NotFoundError("Target conversation not found");
      }
      if (message.senderType === "SYSTEM") throw new BadRequestError("System messages cannot be forwarded");
      if (message.messageType !== "TEXT" || message.content === null) {
        throw new BadRequestError("Only text messages can be forwarded");
      }
      if (!permissionsFor(auth, target).canSendMessage) {
        throw new ForbiddenError("You can only forward into an open conversation you own");
      }
      const sameCustomer = source.customerId !== null && source.customerId === target.customerId;
      if (!sameCustomer && target.conversationType !== "INTERNAL") {
        throw new ForbiddenError(
          "Messages can only be forwarded within the same customer's conversations or to internal ones",
        );
      }

      const existing = await tx.findByClientId(target.id, input.clientId);
      if (existing) {
        if (existing.senderId !== auth.userId || existing.forwardedFromMessageId !== message.id) {
          throw new ConflictError("clientId is already used by another message");
        }
        return { message: existing, created: false, from: message };
      }
      const stored = await tx.append({
        conversationId: target.id,
        clientId: input.clientId,
        senderType: "AGENT",
        senderId: auth.userId,
        messageType: "TEXT",
        content: message.content,
        forwardedFromMessageId: message.id,
        metadata: {
          forwardedFrom: {
            conversationId: message.conversationId,
            messageId: message.id,
            senderType: message.senderType,
            senderId: message.senderId,
          },
        },
        preview: toPreview(message.content),
      });
      return { message: stored, created: true, from: message };
    });

    const dto = toMessage(result.message);
    if (result.created) {
      await bestEffort("realtime", () => this.realtime.messageCreated(dto, { conversationUpdated: true }));
      await this.publish(dto.conversationId, "message.forwarded", {
        message: dto,
        forwardedFrom: {
          conversationId: idToString(result.from.conversationId),
          messageId: idToString(result.from.id),
        },
      });
    }
    return { message: dto, created: result.created };
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  /**
   * Finds a message and locks its conversation, hiding messages the caller cannot see (and, unless asked, deleted
   * ones) as "not found" so their existence is not revealed.
   */
  /**
   * Pins a message to the top of its conversation for every agent. Changing pins follows the "organize" rule (the
   * owner or a supervisor, or anyone while nobody owns the chat); everyone who can see the chat sees them. Pinning a
   * pinned message changes nothing. The conversation row is locked, so concurrent pins cannot pass the limit.
   */
  async pin(auth: AuthContext, messageId: string): Promise<PinDto> {
    const row = await this.repository.inTransaction(async (tx) => {
      const { message, conversation } = await this.loadVisible(tx, auth, messageId);
      if (message.senderType === "SYSTEM") throw new BadRequestError("System messages cannot be pinned");
      if (!permissionsFor(auth, conversation).canOrganize) {
        throw new ForbiddenError("Only the agent handling this conversation or a supervisor can change pins");
      }
      const existing = await tx.findPin(message.id);
      if (existing && existing.unpinnedAt === null) return existing;
      if ((await tx.activePins(conversation.id)).length >= MAX_PINS) {
        throw new ConflictError(`A conversation can have at most ${MAX_PINS} pinned messages; unpin one first`);
      }
      return tx.pin(conversation.id, message.id, auth.userId);
    });
    return toPin(row);
  }

  /** Unpins a message (same rule as pinning). Unpinning one that is not pinned changes nothing. */
  async unpin(auth: AuthContext, messageId: string): Promise<void> {
    await this.repository.inTransaction(async (tx) => {
      const { message, conversation } = await this.loadVisible(tx, auth, messageId);
      if (!permissionsFor(auth, conversation).canOrganize) {
        throw new ForbiddenError("Only the agent handling this conversation or a supervisor can change pins");
      }
      await tx.unpin(message.id, auth.userId);
    });
  }

  private async loadVisible(tx: MessageRepository, auth: AuthContext, messageId: string, includeDeleted = false) {
    const found = await tx.findAnyById(messageId);
    const conversation = found ? await tx.lock(found.conversationId) : null;
    // Read again under the lock: the message may have been deleted or edited while waiting for it.
    const message = conversation ? await tx.findAnyById(messageId) : null;
    if (!message || !conversation || !canView(auth, conversation, await tx.isViewer(conversation.id, auth.userId))) {
      throw new NotFoundError("Message not found");
    }
    if (message.deletedAt !== null && !includeDeleted) throw new NotFoundError("Message not found");
    return { message, conversation };
  }

  private reactable({ message }: { message: MessageRow }) {
    if (message.senderType === "SYSTEM") throw new BadRequestError("System messages cannot be reacted to");
    return message;
  }

  /** Keeps the inbox preview in step when the newest message was edited or deleted. Returns whether it changed. */
  private async refreshPreview(tx: MessageRepository, changed: MessageRow): Promise<boolean> {
    const source = await tx.previewSource(changed.conversationId);
    // Only the newest previewable message feeds the preview; with none left the preview is empty.
    if (source && source.id !== changed.id && changed.deletedAt === null) return false;
    await tx.setPreview(changed.conversationId, source?.content ? toPreview(source.content) : null);
    return true;
  }

  private async withReactions(message: MessageRow) {
    return toMessage(message, (await this.repository.reactionsFor([message.id])).get(message.id));
  }

  private async announceReactions(message: MessageRow) {
    const reactions = ((await this.repository.reactionsFor([message.id])).get(message.id) ?? []).map(toReaction);
    await this.publish(idToString(message.conversationId), "message.reaction_updated", {
      conversationId: idToString(message.conversationId),
      messageId: idToString(message.id),
      reactions,
    });
    return reactions;
  }

  private publish(conversationId: string, type: string, payload: object, conversationUpdated = false) {
    return bestEffort(`realtime ${type}`, () =>
      this.realtime.messageEvent(conversationId, type, payload, { conversationUpdated }),
    );
  }
}
