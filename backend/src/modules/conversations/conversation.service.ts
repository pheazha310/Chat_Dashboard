import { logger } from "@config/logger.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import type { AvailableAgents } from "@shared/ports/available-agents.js";
import type {
  AccessibleConversationState,
  ConversationAccess,
  ConversationSummaries,
} from "@shared/ports/conversation-access.js";
import type { AgentProfile, Directory } from "@shared/ports/directory.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import type { SystemMessagePort } from "@shared/ports/system-message.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import { pageArgs, pageMeta, type PageQuery } from "@shared/utils/pagination.js";
import type { NotificationService } from "@modules/notifications/index.js";
import { canView, permissionsFor } from "@shared/policy/conversation-access.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { CreateInput, ListQuery } from "./conversation.schema.js";
import type {
  AccessibleConversation,
  ActivityDto,
  ConversationDetailDto,
  ConversationEventDto,
  ConversationPermissions,
  ConversationPriority,
  ConversationStatus,
  ConversationSummaryDto,
  ConversationWithTags,
} from "./conversation.types.js";
import type { ConversationActivity } from "../../../prisma/generated/prisma/client.js";

export class ConversationService implements ConversationAccess, ConversationSummaries {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly systemMessages: SystemMessagePort,
    private readonly realtime: RealtimeNotifier,
    private readonly directory: Directory,
    private readonly notifications: NotificationService,
    private readonly availableAgents: AvailableAgents,
  ) {}

  async list(auth: AuthContext, query: ListQuery) {
    const unreadIds = query.filter === "unread" ? await this.repository.unreadConversationIds(auth.userId) : [];
    const { items, total } = await this.repository.listInbox(auth, query, unreadIds);
    const unread = await this.repository.unreadCounts(
      auth.userId,
      items.map((item) => item.id),
    );
    const agents = await this.agentProfiles(items.map((item) => item.assignedAgentId));
    return {
      items: items.map((item) => toSummary(item, unread.get(item.id) ?? 0, agents)),
      meta: pageMeta(total, query),
    };
  }

  async get(auth: AuthContext, id: string) {
    const conversation = await this.load(auth, id);
    const unread = await this.repository.unreadCounts(auth.userId, [id]);
    const agents = await this.agentProfiles([conversation.assignedAgentId]);
    return toDetail(conversation, unread.get(id) ?? 0, permissionsFor(auth, conversation), agents);
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
    if (created) {
      await bestEffort("realtime", () => this.realtime.conversationEvent(id, "created"));
      await bestEffort("new-conversation notifications", () => this.notifyAvailableAgents(auth, id, input));
    }
    return { conversation: await this.get(auth, id), created };
  }

  async changeStatus(auth: AuthContext, id: string, to: ConversationStatus) {
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
    const verb = { OPEN: "reopened", RESOLVED: "resolved", CLOSED: "closed" }[to];
    await bestEffort("system message", () =>
      this.systemMessages.post(id, `Agent ${auth.userId} ${verb} the conversation`, {
        event: `status_${to.toLowerCase()}`,
        actorId: idToString(auth.userId),
        from: conversation.status,
        to,
      }),
    );
    await bestEffort("realtime", () =>
      this.realtime.conversationEvent(id, "status_changed", {
        from: conversation.status,
        to,
        actorId: idToString(auth.userId),
      }),
    );
    return this.get(auth, id);
  }

  /**
   * Changes the priority (HIGH, MEDIUM, LOW). The owner, a supervisor, or anyone while nobody owns the conversation.
   * Setting the value it already has changes nothing. Two simultaneous changes: one wins, the other gets a 409.
   */
  async changePriority(auth: AuthContext, id: string, priority: ConversationPriority) {
    const conversation = await this.load(auth, id);
    if (!permissionsFor(auth, conversation).canOrganize) {
      throw new ForbiddenError("Only the owner or a supervisor can change this conversation's priority");
    }
    if (conversation.priority === priority) return this.get(auth, id);
    await this.repository.inTransaction(async (tx) => {
      if (!(await tx.transitionPriority(id, conversation.priority, priority))) {
        throw new ConflictError("The conversation changed; refresh and try again");
      }
      await tx.addActivity({
        conversationId: id,
        actorType: "AGENT",
        actorId: auth.userId,
        activityType: "PRIORITY_CHANGED",
        description: `Priority changed from ${conversation.priority} to ${priority}`,
        metadata: { from: conversation.priority, to: priority },
      });
    });
    await bestEffort("realtime", () =>
      this.realtime.conversationEvent(id, "priority_changed", { from: conversation.priority, to: priority }),
    );
    return this.get(auth, id);
  }

  archive(auth: AuthContext, id: string) {
    return this.setArchived(auth, id, true);
  }

  restore(auth: AuthContext, id: string) {
    return this.setArchived(auth, id, false);
  }

  async activities(auth: AuthContext, id: string, query: PageQuery) {
    await this.load(auth, id);
    const { items, total } = await this.repository.listActivities(id, pageArgs(query));
    return { items: items.map(toActivity), meta: pageMeta(total, query) };
  }

  private async setArchived(auth: AuthContext, id: string, archived: boolean) {
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
    await bestEffort("realtime", () => this.realtime.conversationEvent(id, "updated"));
    return this.get(auth, id);
  }

  async requireVisible(auth: AuthContext, id: string): Promise<AccessibleConversationState> {
    return this.load(auth, id);
  }

  /** A conversation is waiting for a human: tell the agents who are online and AVAILABLE (not the one who opened it). */
  private async notifyAvailableAgents(auth: AuthContext, id: string, input: CreateInput) {
    const agents = (await this.availableAgents.availableAgentIds()).filter((agent) => agent !== auth.userId);
    const who = input.customerName ?? `customer ${input.customerId}`;
    await Promise.all(
      agents.map((agentId) =>
        this.notifications.notifyAgent({
          agentId,
          type: "NEW_CONVERSATION",
          title: "New conversation needs attention",
          body: `${who} is waiting for an agent`,
          conversationId: id,
        }),
      ),
    );
  }

  /** Agent names from Backend 1. If it is unreachable the conversations still load, just without the profile. */
  private async agentProfiles(ids: (string | null)[]): Promise<Map<string, AgentProfile>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map();
    try {
      return new Map((await this.directory.getAgents(wanted)).map((agent) => [agent.id, agent]));
    } catch (error) {
      logger.warn({ err: error }, "agent profiles unavailable");
      return new Map();
    }
  }

  async visibleSummaries(auth: AuthContext, ids: string[]) {
    const unique = [...new Set(ids)];
    const found = unique.length === 0 ? [] : await this.repository.findManyForAccess(unique, auth.userId);
    const visible = found.filter((row) =>
      canView(
        auth,
        row,
        row.conversationAssignments.some((a) => a.assignmentType === "VIEWER"),
      ),
    );
    const unread = await this.repository.unreadCounts(
      auth.userId,
      visible.map((row) => row.id),
    );
    const agents = await this.agentProfiles(visible.map((row) => row.assignedAgentId));
    return new Map(visible.map((row) => [row.id, toSummary(row, unread.get(row.id) ?? 0, agents)]));
  }

  /** Typing indicators come only from whoever may send in the conversation (same rule as sending). */
  async assertCanType(auth: AuthContext, id: string) {
    const conversation = await this.load(auth, id);
    if (!permissionsFor(auth, conversation).canSendMessage) {
      throw new ForbiddenError("Only the agent who owns an open conversation can send typing indicators");
    }
  }

  /**
   * Public state of a conversation plus who may see it, for realtime events. Not caller-specific (no unread count,
   * no permissions): each recipient's own view is derived on their client or by REST.
   */
  async snapshot(id: string) {
    const found = await this.repository.findForEvent(id);
    if (!found) return null;
    const agents = await this.agentProfiles([found.conversation.assignedAgentId]);
    const { unreadCount: _omit, ...conversation } = toSummary(found.conversation, 0, agents);
    const event: ConversationEventDto = conversation;
    return {
      conversation: event,
      audience: {
        handoffStatus: found.conversation.handoffStatus,
        assignedAgentId:
          found.conversation.assignedAgentId === null ? null : idToString(found.conversation.assignedAgentId),
        viewerIds: found.viewerIds.map(idToString),
      },
    };
  }

  /** Loads a conversation the caller may see; hidden ones look like missing ones so existence is not leaked. */
  private async load(auth: AuthContext, id: string): Promise<AccessibleConversation> {
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

// ─── DTO mapping ───────────────────────────────────────────────────────────

const nullableId = (value: string | null) => (value === null ? null : idToString(value));
const iso = (value: Date | null) => (value === null ? null : value.toISOString());

function toSummary(
  row: ConversationWithTags,
  unreadCount: number,
  agents: Map<string, AgentProfile>,
): ConversationSummaryDto {
  return {
    id: idToString(row.id),
    customerId: nullableId(row.customerId),
    customerName: row.customerName,
    customerIdentifier: row.customerIdentifier,
    applicationId: nullableId(row.applicationId),
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    conversationMode: row.conversationMode,
    handoffStatus: row.handoffStatus,
    assignedAgentId: nullableId(row.assignedAgentId),
    assignedAgent: row.assignedAgentId === null ? null : (agents.get(row.assignedAgentId.toString()) ?? null),
    isArchived: row.isArchived,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastMessagePreview: row.lastMessagePreview,
    unreadCount,
    tags: row.conversationTags.map(({ tag }) => ({ id: idToString(tag.id), name: tag.name, color: tag.color })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: iso(row.resolvedAt),
    closedAt: iso(row.closedAt),
  };
}

function toDetail(
  row: ConversationWithTags,
  unreadCount: number,
  permissions: ConversationPermissions,
  agents: Map<string, AgentProfile>,
): ConversationDetailDto {
  return {
    ...toSummary(row, unreadCount, agents),
    summary: row.summary,
    lastSequenceNumber: row.lastSequenceNumber.toString(),
    permissions,
  };
}

const toActivity = (row: ConversationActivity): ActivityDto => ({
  id: idToString(row.id),
  conversationId: idToString(row.conversationId),
  actorType: row.actorType,
  actorId: nullableId(row.actorId),
  activityType: row.activityType,
  description: row.description,
  metadata: row.metadata,
  createdAt: row.createdAt.toISOString(),
});
