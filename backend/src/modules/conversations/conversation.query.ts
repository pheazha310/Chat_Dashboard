import type { Prisma } from "../../../prisma/generated/prisma/client.js";
import { isSupervisor, type AuthContext } from "@shared/auth/auth.types.js";
import type { ListQuery } from "./conversation.schema.js";

/** SQL form of `canView` so search and filters never return conversations the caller cannot open (FR-07). */
export function visibilityWhere(auth: AuthContext): Prisma.ConversationWhereInput {
  if (isSupervisor(auth)) return {};
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
  unreadIds: bigint[] = [],
): Prisma.ConversationWhereInput {
  const and: Prisma.ConversationWhereInput[] = [visibilityWhere(auth)];

  and.push({ isArchived: query.filter === "archived" });
  if (query.filter === "mine") and.push({ assignedAgentId: auth.userId });
  if (query.filter === "unassigned") and.push({ handoffStatus: "NEEDS_HUMAN" });
  if (query.filter === "unread") and.push({ id: { in: unreadIds } });

  if (query.status) and.push({ status: query.status });
  if (query.priority) and.push({ priority: query.priority });
  if (query.tag) and.push({ conversationTags: { some: { tagId: query.tag } } });

  if (query.q) {
    const text = { contains: query.q, mode: "insensitive" } as const;
    const or: Prisma.ConversationWhereInput[] = [{ customerName: text }, { customerIdentifier: text }];
    if (/^[1-9]\d{0,17}$/.test(query.q)) or.push({ customerId: BigInt(query.q) });
    and.push({ OR: or });
  }
  return { AND: and };
}

export const inboxOrderBy: Prisma.ConversationOrderByWithRelationInput[] = [{ lastMessageAt: "desc" }, { id: "desc" }];
