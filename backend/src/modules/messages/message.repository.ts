import { prisma, runInTransaction, type Db } from "@config/database.js";
import { Prisma } from "../../../prisma/generated/prisma/client.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { can } from "@shared/auth/permissions.js";
import type { CursorQuery } from "@shared/utils/pagination.js";
import type {
  AttachmentRow,
  EditHistoryRow,
  LockedConversation,
  MessagePage,
  MessageRow,
  PinRow,
  ReactionRow,
  SearchAllRow,
} from "./message.types.js";

interface AppendInput {
  conversationId: string;
  clientId: string | null;
  senderType: string;
  senderId: string | null;
  messageType: string;
  content: string | null;
  metadata?: Prisma.InputJsonValue;
  replyToMessageId?: string | null;
  forwardedFromMessageId?: string | null;
  /** Updates the inbox preview and last-activity time (not for SYSTEM messages). */
  preview: string | null;
}

/** File metadata for a message that carries a file; the bytes are in storage under `storageKey`. */
export interface NewAttachment {
  storageKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  durationMs?: number | undefined;
  waveform?: number[] | undefined;
  checksumSha256: string;
}

export class MessageRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: MessageRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new MessageRepository(tx)));
  }

  /** Locks the conversation row until commit, so concurrent senders and retries are processed one at a time. */
  async lock(id: string): Promise<LockedConversation | null> {
    const rows = await this.db.$queryRaw<LockedConversation[]>`
      SELECT id, customer_id AS "customerId", conversation_type AS "conversationType", status, handoff_status AS "handoffStatus",
             assigned_agent_id AS "assignedAgentId", is_archived AS "isArchived"
        FROM conversations WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  async isViewer(conversationId: string, agentId: string): Promise<boolean> {
    const count = await this.db.conversationAssignment.count({
      where: { conversationId, agentId, endedAt: null, assignmentType: "VIEWER" },
    });
    return count > 0;
  }

  findByClientId(conversationId: string, clientId: string): Promise<MessageRow | null> {
    return this.db.message.findUnique({ where: { conversationId_clientId: { conversationId, clientId } } });
  }

  findById(conversationId: string, id: string): Promise<MessageRow | null> {
    return this.db.message.findFirst({ where: { id, conversationId, deletedAt: null } });
  }

  /** Allocates the next sequence number under the row lock and inserts the message in the same statement order. */
  async append(input: AppendInput): Promise<MessageRow> {
    const rows =
      input.preview === null
        ? await this.db.$queryRaw<{ seq: bigint; at: Date }[]>`
            UPDATE conversations SET last_sequence_number = last_sequence_number + 1, updated_at = now()
             WHERE id = ${input.conversationId}::uuid RETURNING last_sequence_number AS seq, now() AS at`
        : await this.db.$queryRaw<{ seq: bigint; at: Date }[]>`
            UPDATE conversations
               SET last_sequence_number = last_sequence_number + 1, last_message_at = now(),
                   last_message_preview = ${input.preview}, updated_at = now()
             WHERE id = ${input.conversationId}::uuid RETURNING last_sequence_number AS seq, now() AS at`;
    const allocated = rows[0];
    if (!allocated) throw new Error("conversation vanished while appending a message");
    const { seq: sequenceNumber, at: createdAt } = allocated;
    return this.db.message.create({
      data: {
        conversationId: input.conversationId,
        clientId: input.clientId,
        sequenceNumber,
        // The database clock, same instant as last_message_at, so ordering never depends on app-server clocks.
        createdAt,
        senderType: input.senderType,
        senderId: input.senderId,
        messageType: input.messageType,
        content: input.content,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        replyToMessageId: input.replyToMessageId ?? null,
        forwardedFromMessageId: input.forwardedFromMessageId ?? null,
      },
    });
  }

  /** A customer message reopens a resolved or closed conversation. */
  async reopen(conversationId: string): Promise<void> {
    await this.db.conversation.updateMany({
      where: { id: conversationId, status: { not: "OPEN" } },
      data: { status: "OPEN", resolvedAt: null, closedAt: null },
    });
  }

  /** A customer message brings an archived conversation back into the inbox. */
  async restore(conversationId: string): Promise<void> {
    await this.db.conversation.updateMany({
      where: { id: conversationId, isArchived: true },
      data: { isArchived: false, archivedAt: null },
    });
  }

  addActivity(data: Prisma.ConversationActivityUncheckedCreateInput) {
    return this.db.conversationActivity.create({ data });
  }

  /**
   * Oldest-to-newest page. `before` pages back in time, `after` forward (reconnect sync); default is the latest.
   * Deleted messages are included (the mapper turns them into placeholders).
   */
  async history(
    conversationId: string,
    query: CursorQuery,
    options: { excludeSystem?: boolean } = {},
  ): Promise<MessagePage> {
    const base = {
      conversationId,
      ...(options.excludeSystem ? { senderType: { not: "SYSTEM" } } : {}),
    };
    if (query.after !== undefined || query.from !== undefined) {
      const rows = await this.db.message.findMany({
        where: {
          ...base,
          ...(query.after === undefined ? { createdAt: { gte: query.from } } : { sequenceNumber: { gt: query.after } }),
        },
        orderBy: { sequenceNumber: "asc" },
        take: query.limit + 1,
      });
      return { items: rows.slice(0, query.limit), hasMore: rows.length > query.limit };
    }
    const rows = await this.db.message.findMany({
      where: { ...base, ...(query.before === undefined ? {} : { sequenceNumber: { lt: query.before } }) },
      orderBy: { sequenceNumber: "desc" },
      take: query.limit + 1,
    });
    return { items: rows.slice(0, query.limit).reverse(), hasMore: rows.length > query.limit };
  }

  /** Messages whose text contains `text` (any case), newest first. Deleted and SYSTEM messages are left out. */
  search(conversationId: string, text: string, take: number): Promise<MessageRow[]> {
    return this.db.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        senderType: { not: "SYSTEM" },
        // Prisma passes `contains` to ILIKE as-is; escape its wildcards so "100%" means the literal text.
        content: { contains: text.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" },
      },
      orderBy: { sequenceNumber: "desc" },
      take,
    });
  }

  /**
   * Messages matching a `to_tsquery('simple', …)` across the conversations `auth` may open, newest first, each with
   * its customer. Matching runs on the `messages_content_fts` index (constraints.sql), which Prisma cannot query.
   */
  async searchAll(auth: AuthContext, tsQuery: string, take: number): Promise<SearchAllRow[]> {
    // SQL form of `canView` (shared/policy/conversation-access.ts); keep the two in step.
    const visible = can(auth, "conversations.view_all")
      ? Prisma.sql`TRUE`
      : Prisma.sql`(c.handoff_status <> 'ASSIGNED' OR c.assigned_agent_id = ${auth.userId}::uuid OR EXISTS (
          SELECT 1 FROM conversation_assignments a
           WHERE a.conversation_id = c.id AND a.agent_id = ${auth.userId}::uuid
             AND a.ended_at IS NULL AND a.assignment_type = 'VIEWER'))`;
    const hits = await this.db.$queryRaw<{ id: string }[]>`
      SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE to_tsvector('simple', coalesce(m.content, '')) @@ to_tsquery('simple', ${tsQuery})
         AND m.deleted_at IS NULL AND m.sender_type <> 'SYSTEM' AND ${visible}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ${take}`;
    const rows = await this.db.message.findMany({
      where: { id: { in: hits.map((hit) => hit.id) } },
      include: { conversation: { select: { id: true, customerName: true, customerIdentifier: true } } },
    });
    const order = new Map(hits.map((hit, index) => [hit.id, index]));
    return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  /** Pins shown in the pin bar, newest first. A deleted message drops out (its pin row stays for audit). */
  activePins(conversationId: string): Promise<PinRow[]> {
    return this.db.messagePin.findMany({
      where: { conversationId, unpinnedAt: null, message: { deletedAt: null } },
      include: { message: true },
      orderBy: [{ pinnedAt: "desc" }, { id: "desc" }],
    });
  }

  findPin(messageId: string) {
    return this.db.messagePin.findUnique({ where: { messageId }, include: { message: true } });
  }

  /** Pins a message, reviving its row if it was pinned before (one row per message). */
  pin(conversationId: string, messageId: string, by: string): Promise<PinRow> {
    const pinned = { pinnedBy: by, pinnedAt: new Date(), unpinnedAt: null, unpinnedBy: null };
    return this.db.messagePin.upsert({
      where: { messageId },
      create: { conversationId, messageId, ...pinned },
      update: pinned,
      include: { message: true },
    });
  }

  async unpin(messageId: string, by: string): Promise<void> {
    await this.db.messagePin.updateMany({
      where: { messageId, unpinnedAt: null },
      data: { unpinnedAt: new Date(), unpinnedBy: by },
    });
  }

  /** The newest message at or before a sequence number (the read marker target). */
  findAtOrBefore(conversationId: string, sequenceNumber: bigint): Promise<MessageRow | null> {
    return this.db.message.findFirst({
      where: { conversationId, sequenceNumber: { lte: sequenceNumber } },
      orderBy: { sequenceNumber: "desc" },
    });
  }

  latest(conversationId: string): Promise<MessageRow | null> {
    return this.db.message.findFirst({ where: { conversationId }, orderBy: { sequenceNumber: "desc" } });
  }

  async readPosition(conversationId: string, agentId: string): Promise<bigint> {
    const row = await this.db.conversationRead.findUnique({
      where: { conversationId_readerType_readerId: { conversationId, readerType: "AGENT", readerId: agentId } },
      select: { lastReadSequenceNumber: true },
    });
    return row?.lastReadSequenceNumber ?? 0n;
  }

  /** Moves the agent's read position forward only (an older tab can never move it back) and clears "marked unread". */
  async advanceRead(
    conversationId: string,
    agentId: string,
    sequenceNumber: bigint,
    messageId: string | null,
  ): Promise<void> {
    await this.db.$executeRaw`
      INSERT INTO conversation_reads (conversation_id, reader_type, reader_id, last_read_message_id,
                                      last_read_sequence_number, last_read_at, marked_unread, created_at, updated_at)
      VALUES (${conversationId}::uuid, 'AGENT', ${agentId}::uuid, ${messageId}::uuid, ${sequenceNumber}, now(), false, now(), now())
      ON CONFLICT (conversation_id, reader_type, reader_id) DO UPDATE SET
        last_read_message_id = CASE WHEN EXCLUDED.last_read_sequence_number >= conversation_reads.last_read_sequence_number
                                    THEN EXCLUDED.last_read_message_id ELSE conversation_reads.last_read_message_id END,
        last_read_sequence_number = GREATEST(conversation_reads.last_read_sequence_number, EXCLUDED.last_read_sequence_number),
        last_read_at = now(), marked_unread = false, updated_at = now()`;
  }

  /**
   * Records read receipts for the customer messages the agent just read and marks those messages READ.
   * Returns the ids whose status changed (to announce over the socket later).
   */
  async receiptReadRange(conversationId: string, agentId: string, from: bigint, to: bigint): Promise<string[]> {
    await this.db.$executeRaw`
      INSERT INTO message_receipts (message_id, recipient_type, recipient_id, delivered_at, read_at, created_at)
      SELECT m.id, 'AGENT', ${agentId}::uuid, now(), now(), now() FROM messages m
       WHERE m.conversation_id = ${conversationId}::uuid AND m.sequence_number > ${from} AND m.sequence_number <= ${to}
         AND m.sender_type = 'CUSTOMER' AND m.deleted_at IS NULL
      ON CONFLICT (message_id, recipient_type, recipient_id) DO UPDATE SET
        delivered_at = COALESCE(message_receipts.delivered_at, EXCLUDED.delivered_at),
        read_at = COALESCE(message_receipts.read_at, EXCLUDED.read_at)`;
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      UPDATE messages SET status = 'READ', updated_at = now()
       WHERE conversation_id = ${conversationId}::uuid AND sequence_number > ${from} AND sequence_number <= ${to}
         AND sender_type = 'CUSTOMER' AND deleted_at IS NULL AND status <> 'READ'
      RETURNING id`;
    return rows.map((row) => row.id);
  }

  /** Delivery receipt for one customer message; status only moves forward (SENT to DELIVERED). */
  async receiptDelivered(messageId: string, agentId: string): Promise<boolean> {
    await this.db.$executeRaw`
      INSERT INTO message_receipts (message_id, recipient_type, recipient_id, delivered_at, created_at)
      VALUES (${messageId}::uuid, 'AGENT', ${agentId}::uuid, now(), now())
      ON CONFLICT (message_id, recipient_type, recipient_id) DO UPDATE SET
        delivered_at = COALESCE(message_receipts.delivered_at, EXCLUDED.delivered_at)`;
    const { count } = await this.db.message.updateMany({
      where: { id: messageId, status: "SENT" },
      data: { status: "DELIVERED" },
    });
    return count === 1;
  }

  /** "Mark as unread": keeps the read position, so only the flag changes. */
  async markUnread(conversationId: string, agentId: string): Promise<void> {
    await this.db.conversationRead.upsert({
      where: { conversationId_readerType_readerId: { conversationId, readerType: "AGENT", readerId: agentId } },
      // No row yet means position 0 (counts already treat it so), so existing unread messages stay unread.
      create: {
        conversationId,
        readerType: "AGENT",
        readerId: agentId,
        lastReadSequenceNumber: 0n,
        markedUnread: true,
      },
      update: { markedUnread: true },
    });
  }

  async unreadState(conversationId: string, agentId: string) {
    const position = await this.readPosition(conversationId, agentId);
    const [unread, read] = await Promise.all([
      this.db.message.count({
        where: { conversationId, senderType: "CUSTOMER", deletedAt: null, sequenceNumber: { gt: position } },
      }),
      this.db.conversationRead.findUnique({
        where: { conversationId_readerType_readerId: { conversationId, readerType: "AGENT", readerId: agentId } },
        select: { markedUnread: true },
      }),
    ]);
    return { position, unread, markedUnread: read?.markedUnread ?? false };
  }

  // ─── Message actions (edit, delete, reactions) ───────────────────────────

  /** A message by id including soft-deleted ones (unlike `findById`, which is scoped to a conversation). */
  findAnyById(id: string): Promise<MessageRow | null> {
    return this.db.message.findUnique({ where: { id } });
  }

  /** Records the text being replaced, then stores the new text. The history row and the update commit together. */
  async applyEdit(message: MessageRow, editorId: string, content: string): Promise<MessageRow> {
    await this.db.messageEditHistory.create({
      data: {
        messageId: message.id,
        editorType: "AGENT",
        editorId,
        previousContent: message.content ?? "",
      },
    });
    return this.db.message.update({
      where: { id: message.id },
      data: { content, isEdited: true, editedAt: new Date() },
    });
  }

  listEditHistory(messageId: string): Promise<EditHistoryRow[]> {
    return this.db.messageEditHistory.findMany({
      where: { messageId },
      orderBy: [{ editedAt: "desc" }, { id: "desc" }],
    });
  }

  /** Soft delete: the row and its edit history stay for audit; every read path filters on `deleted_at`. */
  async softDelete(id: string, deletedBy: string): Promise<MessageRow> {
    const now = new Date();
    // Its files go with it: they must not stay downloadable once the message is deleted.
    await this.db.attachment.updateMany({
      where: { deletedAt: null, messageAttachments: { some: { messageId: id } } },
      data: { deletedAt: now },
    });
    return this.db.message.update({ where: { id }, data: { deletedAt: now, deletedBy } });
  }

  // ─── Attachments carried by a message ────────────────────────────────────

  /** Stores the file's metadata and links it to the message. The bytes are already in storage. */
  async addAttachment(
    data: NewAttachment & {
      conversationId: string;
      messageId: string;
      uploadedById: string;
      uploadedByType?: "AGENT" | "CUSTOMER";
    },
  ) {
    const attachment = await this.db.attachment.create({
      data: {
        conversationId: data.conversationId,
        uploadedByType: data.uploadedByType ?? "AGENT",
        uploadedById: data.uploadedById,
        storageKey: data.storageKey,
        fileName: data.fileName,
        mimeType: data.mimeType,
        fileSize: BigInt(data.fileSize),
        durationMs: data.durationMs ?? null,
        ...(data.waveform === undefined ? {} : { waveform: data.waveform }),
        checksumSha256: data.checksumSha256,
        uploadStatus: "UPLOADED",
      },
    });
    await this.db.messageAttachment.create({
      data: { messageId: data.messageId, attachmentId: attachment.id, conversationId: data.conversationId },
    });
    return attachment;
  }

  /** Live attachments of several messages, grouped by message. */
  async attachmentsFor(messageIds: string[]): Promise<Map<string, AttachmentRow[]>> {
    const grouped = new Map<string, AttachmentRow[]>();
    if (messageIds.length === 0) return grouped;
    const links = await this.db.messageAttachment.findMany({
      where: { messageId: { in: messageIds }, attachment: { deletedAt: null } },
      include: { attachment: true },
      orderBy: { createdAt: "asc" },
    });
    for (const link of links) grouped.set(link.messageId, [...(grouped.get(link.messageId) ?? []), link.attachment]);
    return grouped;
  }

  /** The message the inbox preview is taken from: the newest non-deleted message that is not a SYSTEM message. */
  previewSource(conversationId: string): Promise<MessageRow | null> {
    return this.db.message.findFirst({
      where: { conversationId, deletedAt: null, senderType: { not: "SYSTEM" } },
      orderBy: { sequenceNumber: "desc" },
    });
  }

  async setPreview(conversationId: string, preview: string | null): Promise<void> {
    await this.db.conversation.update({ where: { id: conversationId }, data: { lastMessagePreview: preview } });
  }

  /** Reactions of several messages, grouped by message, oldest first. */
  async reactionsFor(messageIds: string[]): Promise<Map<string, ReactionRow[]>> {
    const grouped = new Map<string, ReactionRow[]>();
    if (messageIds.length === 0) return grouped;
    const rows = await this.db.messageReaction.findMany({
      where: { messageId: { in: messageIds }, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const row of rows) grouped.set(row.messageId, [...(grouped.get(row.messageId) ?? []), row]);
    return grouped;
  }

  countDistinctReactions(messageId: string, userId: string) {
    return this.db.messageReaction.count({ where: { messageId, userType: "AGENT", userId, deletedAt: null } });
  }

  /**
   * Adds the reaction unless the same user already reacted with the same emoji (the unique key makes this race-safe).
   * A reaction the user removed earlier (soft-deleted) is revived instead of duplicated.
   */
  addReaction(messageId: string, userId: string, emoji: string): Promise<ReactionRow> {
    return this.db.messageReaction.upsert({
      where: { messageId_userType_userId_emoji: { messageId, userType: "AGENT", userId, emoji } },
      create: { messageId, userType: "AGENT", userId, emoji },
      update: { deletedAt: null },
    });
  }

  findReaction(id: string): Promise<ReactionRow | null> {
    return this.db.messageReaction.findFirst({ where: { id, deletedAt: null } });
  }

  /** Soft delete: the row stays with `deleted_at` set. */
  async deleteReaction(id: string): Promise<void> {
    await this.db.messageReaction.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  }
}
