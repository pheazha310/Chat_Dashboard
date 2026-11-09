import { prisma, runInTransaction, type Db } from "@config/database.js";
import type { Prisma } from "../../../prisma/generated/prisma/client.js";
import { z } from "zod";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { can } from "@shared/auth/permissions.js";
import { pageArgs, type PageQuery } from "@shared/utils/pagination.js";
import type { ListQuery } from "./conversation.schema.js";
import type { AccessibleConversation, ConversationWithTags } from "./conversation.types.js";

const withTags = { conversationTags: { include: { tag: true } } } satisfies Prisma.ConversationInclude;

export class ConversationRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: ConversationRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new ConversationRepository(tx)));
  }

  /** One page of the caller's inbox, newest activity first. `unreadIds` is only used by the `unread` filter. */
  async listInbox(auth: AuthContext, query: ListQuery, unreadIds: string[]) {
    const where = buildInboxWhere(auth, query, unreadIds);
    if (query.sort === "priority") return this.listByPriority(where, query);
    const [items, total] = await Promise.all([
      this.db.conversation.findMany({ where, orderBy: inboxOrderBy, ...pageArgs(query), include: withTags }),
      this.db.conversation.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * HIGH, then MEDIUM, then LOW, latest activity first inside each. The priority names do not sort in that order, so
   * the page is cut out of the three groups one after the other instead of sorting on the column.
   */
  private async listByPriority(where: Prisma.ConversationWhereInput, query: ListQuery) {
    const groups = ["HIGH", "MEDIUM", "LOW"] as const;
    const counts = await Promise.all(
      groups.map((priority) => this.db.conversation.count({ where: { AND: [where, { priority }] } })),
    );
    let skip = (query.page - 1) * query.size;
    let take = query.size;
    const items: ConversationWithTags[] = [];
    for (const [index, priority] of groups.entries()) {
      const size = counts[index] ?? 0;
      if (skip >= size) {
        skip -= size;
        continue;
      }
      const here = Math.min(take, size - skip);
      items.push(
        ...(await this.db.conversation.findMany({
          where: { AND: [where, { priority }] },
          orderBy: inboxOrderBy,
          skip,
          take: here,
          include: withTags,
        })),
      );
      take -= here;
      skip = 0;
      if (take === 0) break;
    }
    return { items, total: counts.reduce((sum, n) => sum + n, 0) };
  }

  /** Unread = customer messages after the agent's read position (plus a manual "mark unread" flag), per agent. */
  async unreadCounts(agentId: string, conversationIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (conversationIds.length === 0) return counts;
    const rows = await this.db.$queryRaw<{ id: string; unread: number }[]>`
      SELECT m.conversation_id AS id, count(*)::int AS unread
        FROM messages m
        LEFT JOIN conversation_reads r
          ON r.conversation_id = m.conversation_id AND r.reader_type = 'AGENT' AND r.reader_id = ${agentId}::uuid
       WHERE m.conversation_id = ANY(${conversationIds}::uuid[])
         AND m.sender_type = 'CUSTOMER' AND m.deleted_at IS NULL
         AND m.sequence_number > COALESCE(r.last_read_sequence_number, 0)
       GROUP BY m.conversation_id`;
    for (const row of rows) counts.set(row.id, row.unread);
    const manual = await this.db.conversationRead.findMany({
      where: { conversationId: { in: conversationIds }, readerType: "AGENT", readerId: agentId, markedUnread: true },
      select: { conversationId: true },
    });
    for (const { conversationId } of manual) counts.set(conversationId, Math.max(1, counts.get(conversationId) ?? 0));
    return counts;
  }

  /** Ids of every conversation with unread messages or a manual unread flag for this agent (the `unread` filter). */
  async unreadConversationIds(agentId: string): Promise<string[]> {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT u.id FROM (
        SELECT m.conversation_id AS id
          FROM messages m
          LEFT JOIN conversation_reads r
            ON r.conversation_id = m.conversation_id AND r.reader_type = 'AGENT' AND r.reader_id = ${agentId}::uuid
         WHERE m.sender_type = 'CUSTOMER' AND m.deleted_at IS NULL
           AND m.sequence_number > COALESCE(r.last_read_sequence_number, 0)
        UNION ALL
        SELECT conversation_id AS id FROM conversation_reads
         WHERE reader_type = 'AGENT' AND reader_id = ${agentId}::uuid AND marked_unread
      ) u`;
    return rows.map((row) => row.id);
  }

  findForAccess(id: string, agentId: string): Promise<AccessibleConversation | null> {
    return this.db.conversation.findUnique({
      where: { id },
      include: {
        ...withTags,
        conversationAssignments: { where: { agentId, endedAt: null }, select: { assignmentType: true } },
      },
    });
  }

  /** Several conversations with the caller's own open assignments, for batch access checks. Unknown ids are absent. */
  findManyForAccess(ids: string[], agentId: string): Promise<AccessibleConversation[]> {
    return this.db.conversation.findMany({
      where: { id: { in: ids } },
      include: {
        ...withTags,
        conversationAssignments: { where: { agentId, endedAt: null }, select: { assignmentType: true } },
      },
    });
  }

  /** For realtime events: the conversation with tags and the agents added to it as VIEWER. */
  async findForEvent(id: string) {
    const conversation = await this.db.conversation.findUnique({ where: { id }, include: withTags });
    if (!conversation) return null;
    const viewers = await this.db.conversationAssignment.findMany({
      where: { conversationId: id, endedAt: null, assignmentType: "VIEWER" },
      select: { agentId: true },
    });
    return { conversation, viewerIds: viewers.map((v) => v.agentId) };
  }

  findByApplication(applicationId: string): Promise<ConversationWithTags | null> {
    return this.db.conversation.findFirst({ where: { applicationId, status: { not: "CLOSED" } }, include: withTags });
  }

  /** The customer's own support conversations (archived ones excluded), latest activity first. */
  async listForCustomer(customerId: string, query: PageQuery) {
    const where = { customerId, conversationType: "CUSTOMER_SUPPORT", isArchived: false };
    const [items, total] = await Promise.all([
      this.db.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        ...pageArgs(query),
        include: withTags,
      }),
      this.db.conversation.count({ where }),
    ]);
    return { items, total };
  }

  /** The customer's most recently active conversation that is not closed (support conversations only). */
  findOpenForCustomer(customerId: string): Promise<ConversationWithTags | null> {
    return this.db.conversation.findFirst({
      where: { customerId, conversationType: "CUSTOMER_SUPPORT", status: { not: "CLOSED" }, isArchived: false },
      orderBy: { lastMessageAt: "desc" },
      include: withTags,
    });
  }

  /** Serializes concurrent creates for one customer for the rest of the transaction. */
  async lockCustomer(customerId: string): Promise<void> {
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${customerId}::text, 0))`;
  }

  create(data: Prisma.ConversationUncheckedCreateInput): Promise<ConversationWithTags> {
    return this.db.conversation.create({ data, include: withTags });
  }

  addCustomerParticipant(conversationId: string, customerId: string) {
    return this.db.conversationParticipant.create({
      data: { conversationId, participantType: "CUSTOMER", participantId: customerId, participantRole: "MEMBER" },
    });
  }

  /** Conditional on the status the caller observed, so two simultaneous transitions cannot both win. */
  /** Conditional on the priority the caller observed, so two simultaneous changes cannot both win. */
  async transitionPriority(id: string, from: string, to: string): Promise<boolean> {
    const { count } = await this.db.conversation.updateMany({ where: { id, priority: from }, data: { priority: to } });
    return count === 1;
  }

  async transitionStatus(
    id: string,
    from: string,
    data: Prisma.ConversationUncheckedUpdateManyInput,
  ): Promise<boolean> {
    const { count } = await this.db.conversation.updateMany({ where: { id, status: from }, data });
    return count === 1;
  }

  /** Ends the open OWNER row and marks the owner as having left (resolve/close release the agent). */
  async releaseOwner(conversationId: string, agentId: string, endedBy: string): Promise<void> {
    const now = new Date();
    await this.db.conversationAssignment.updateMany({
      where: { conversationId, endedAt: null, assignmentType: "OWNER" },
      data: { endedAt: now, endedBy },
    });
    await this.db.conversationParticipant.updateMany({
      where: { conversationId, participantType: "AGENT", participantId: agentId, leftAt: null },
      data: { leftAt: now },
    });
  }

  async setArchived(id: string, archived: boolean): Promise<boolean> {
    const { count } = await this.db.conversation.updateMany({
      where: { id, isArchived: !archived },
      data: { isArchived: archived, archivedAt: archived ? new Date() : null },
    });
    return count === 1;
  }

  addActivity(data: Prisma.ConversationActivityUncheckedCreateInput) {
    return this.db.conversationActivity.create({ data });
  }

  async listActivities(conversationId: string, page: { skip: number; take: number }) {
    const where = { conversationId };
    const [items, total] = await Promise.all([
      this.db.conversationActivity.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...page }),
      this.db.conversationActivity.count({ where }),
    ]);
    return { items, total };
  }
}

// ─── Query building (pure; exported for tests) ──────────────────────────────

/** SQL form of `canView` so search and filters never return conversations the caller cannot open (FR-07). */
export function visibilityWhere(auth: AuthContext): Prisma.ConversationWhereInput {
  if (can(auth, "conversations.view_all")) return {};
  return {
    OR: [
      { handoffStatus: { not: "ASSIGNED" } },
      { assignedAgentId: auth.userId },
      { conversationAssignments: { some: { agentId: auth.userId, endedAt: null, assignmentType: "VIEWER" } } },
    ],
  };
}

/**
 * Inbox WHERE clause. "Unassigned" means waiting in the shared queue (handoff NEEDS_HUMAN).
 * `unreadIds` is only needed for the `unread` filter.
 */
export function buildInboxWhere(
  auth: AuthContext,
  query: ListQuery,
  unreadIds: string[] = [],
): Prisma.ConversationWhereInput {
  const and: Prisma.ConversationWhereInput[] = [visibilityWhere(auth)];

  // A customer's history includes archived conversations; the inbox hides them unless asked.
  if (query.filter === "archived") and.push({ isArchived: true });
  else if (query.customerId === undefined) and.push({ isArchived: false });
  if (query.customerId !== undefined) and.push({ customerId: query.customerId });
  if (query.excludeId !== undefined) and.push({ id: { not: query.excludeId } });
  if (query.filter === "mine") and.push({ assignedAgentId: auth.userId });
  if (query.filter === "unassigned") and.push({ handoffStatus: "NEEDS_HUMAN" });
  if (query.filter === "unread") and.push({ id: { in: unreadIds } });

  if (query.status) and.push({ status: query.status });
  if (query.priority) and.push({ priority: query.priority });
  const tagIds = [...new Set([...(query.tag ? [query.tag] : []), ...(query.tags ?? [])])];
  const [onlyTag] = tagIds;
  if (tagIds.length === 1 && onlyTag !== undefined) and.push({ conversationTags: { some: { tagId: onlyTag } } });
  else if (tagIds.length > 1 && query.tagMatch === "all") {
    for (const tagId of tagIds) and.push({ conversationTags: { some: { tagId } } });
  } else if (tagIds.length > 1) and.push({ conversationTags: { some: { tagId: { in: tagIds } } } });

  if (query.q) {
    const text = { contains: query.q, mode: "insensitive" } as const;
    const or: Prisma.ConversationWhereInput[] = [{ customerName: text }, { customerIdentifier: text }];
    if (z.uuid().safeParse(query.q).success) or.push({ customerId: query.q.toLowerCase() });
    and.push({ OR: or });
  }
  return { AND: and };
}

export const inboxOrderBy: Prisma.ConversationOrderByWithRelationInput[] = [{ lastMessageAt: "desc" }, { id: "desc" }];
