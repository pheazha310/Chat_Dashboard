import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { idToString } from "@shared/utils/ids.js";
import { pageArgs, pageMeta, type PageQuery } from "@shared/utils/pagination.js";
import { toActivity, toDetail, toSummary } from "./conversation.mapper.js";
import { canView, permissionsFor } from "@shared/policy/conversation-access.js";
import { buildInboxWhere, inboxOrderBy } from "./conversation.query.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { CreateInput, ListQuery } from "./conversation.schema.js";
import type { AccessibleConversation, ConversationStatus } from "./conversation.types.js";

export class ConversationService {
  constructor(private readonly repository: ConversationRepository) {}

  async list(auth: AuthContext, query: ListQuery) {
    const unreadIds = query.filter === "unread" ? await this.repository.unreadConversationIds(auth.userId) : [];
    const { items, total } = await this.repository.list(
      buildInboxWhere(auth, query, unreadIds),
      inboxOrderBy,
      pageArgs(query),
    );
    const unread = await this.repository.unreadCounts(
      auth.userId,
      items.map((item) => item.id),
    );
    return { items: items.map((item) => toSummary(item, unread.get(item.id) ?? 0)), meta: pageMeta(total, query) };
  }

  async get(auth: AuthContext, id: bigint) {
    const conversation = await this.load(auth, id);
    const unread = await this.repository.unreadCounts(auth.userId, [id]);
    return toDetail(conversation, unread.get(id) ?? 0, permissionsFor(auth, conversation));
  }

  /**
   * Finds the open conversation for the application or creates one. NOTE: the customer and application are not yet
   * verified with Backend 1 (its API contract is unknown), so callers are trusted to send real ids.
   */
  async create(auth: AuthContext, input: CreateInput) {
    const { id, created } = await this.repository.inTransaction(async (tx) => {
      await tx.lockCustomer(input.customerId);
      if (input.applicationId !== undefined) {
        const existing = await tx.findByApplication(input.applicationId);
        if (existing) {
          if (existing.customerId !== input.customerId) {
            throw new ConflictError("The application belongs to a different customer");
          }
          return { id: existing.id, created: false };
        }
      }
      const conversation = await tx.create({
        customerId: input.customerId,
        applicationId: input.applicationId ?? null,
        customerName: input.customerName ?? null,
        customerIdentifier: input.customerIdentifier ?? null,
        subject: input.subject ?? null,
        priority: input.priority,
        createdByType: "AGENT",
        createdById: auth.userId,
        // A human opened it, so it waits in the shared queue rather than for the (unbuilt) AI worker.
        conversationMode: "HUMAN",
        handoffStatus: "NEEDS_HUMAN",
      });
      await tx.addCustomerParticipant(conversation.id, input.customerId);
      return { id: conversation.id, created: true };
    });
    return { conversation: await this.get(auth, id), created };
  }

  async changeStatus(auth: AuthContext, id: bigint, to: ConversationStatus) {
    const conversation = await this.load(auth, id);
    if (conversation.status === to) throw new ConflictError(`Conversation is already ${to}`);
    const permissions = permissionsFor(auth, conversation);
    const allowed = { OPEN: permissions.canReopen, RESOLVED: permissions.canResolve, CLOSED: permissions.canClose }[to];
    if (!allowed) throw new ForbiddenError(`You cannot set this conversation to ${to}`);

    const owner = conversation.assignedAgentId;
    await this.repository.inTransaction(async (tx) => {
      const won = await tx.transitionStatus(id, conversation.status, statusPatch(to, conversation));
      if (!won) throw new ConflictError("The conversation changed; refresh and try again");
      if (to !== "OPEN" && owner !== null) await tx.releaseOwner(id, owner, auth.userId);
      await tx.addActivity({
        conversationId: id,
        actorType: "AGENT",
        actorId: auth.userId,
        activityType: "STATUS_CHANGED",
        description: `Status changed from ${conversation.status} to ${to}`,
        metadata: { from: conversation.status, to },
      });
    });
    return this.get(auth, id);
  }

  archive(auth: AuthContext, id: bigint) {
    return this.setArchived(auth, id, true);
  }

  restore(auth: AuthContext, id: bigint) {
    return this.setArchived(auth, id, false);
  }

  async activities(auth: AuthContext, id: bigint, query: PageQuery) {
    await this.load(auth, id);
    const { items, total } = await this.repository.listActivities(id, pageArgs(query));
    return { items: items.map(toActivity), meta: pageMeta(total, query) };
  }

  private async setArchived(auth: AuthContext, id: bigint, archived: boolean) {
    const conversation = await this.load(auth, id);
    const permissions = permissionsFor(auth, conversation);
    if (conversation.isArchived === archived) {
      throw new ConflictError(`Conversation is already ${archived ? "archived" : "active"}`);
    }
    if (!(archived ? permissions.canArchive : permissions.canRestore)) {
      throw new ForbiddenError(`You cannot ${archived ? "archive" : "restore"} this conversation`);
    }
    await this.repository.inTransaction(async (tx) => {
      if (!(await tx.setArchived(id, archived)))
        throw new ConflictError("The conversation changed; refresh and try again");
      await tx.addActivity({
        conversationId: id,
        actorType: "AGENT",
        actorId: auth.userId,
        activityType: archived ? "ARCHIVED" : "RESTORED",
        description: archived ? "Conversation archived" : "Conversation restored",
      });
    });
    return this.get(auth, id);
  }

  /** Loads a conversation the caller may see; hidden ones look like missing ones so existence is not leaked. */
  private async load(auth: AuthContext, id: bigint): Promise<AccessibleConversation> {
    const conversation = await this.repository.findForAccess(id, auth.userId);
    const viewer = conversation?.conversationAssignments.some((a) => a.assignmentType === "VIEWER") ?? false;
    if (!conversation || !canView(auth, conversation, viewer)) {
      throw new NotFoundError(`Conversation ${idToString(id)} not found`);
    }
    return conversation;
  }
}

/**
 * Column changes for a status transition. Resolving or closing releases the agent (handoff NONE, AI mode); reopening
 * puts an unowned conversation back in the shared queue so an agent can take it over.
 */
function statusPatch(to: ConversationStatus, current: AccessibleConversation) {
  switch (to) {
    case "RESOLVED":
      return { status: to, resolvedAt: new Date(), closedAt: null, ...released };
    case "CLOSED":
      return { status: to, closedAt: new Date(), resolvedAt: current.resolvedAt, ...released };
    case "OPEN":
      return {
        status: to,
        resolvedAt: null,
        closedAt: null,
        ...(current.handoffStatus === "ASSIGNED" ? {} : { handoffStatus: "NEEDS_HUMAN", conversationMode: "HUMAN" }),
      };
    default:
      throw new BadRequestError("Unknown status");
  }
}

const released = { handoffStatus: "NONE", conversationMode: "AI", assignedAgentId: null } as const;
