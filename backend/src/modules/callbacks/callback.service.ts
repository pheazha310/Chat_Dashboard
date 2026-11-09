import { logger } from "@config/logger.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
} from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { can } from "@shared/auth/permissions.js";
import type { Directory } from "@shared/ports/directory.js";
import type { ConversationAccess } from "@shared/ports/conversation-access.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import { pageMeta } from "@shared/utils/pagination.js";
import type { NotifyAgentInput } from "@modules/notifications/notification.types.js";
import type { CallbackRepository, CallbackRow } from "./callback.repository.js";
import {
  MAX_PENDING_PER_CONVERSATION,
  MAX_SCHEDULE_AHEAD_DAYS,
  type CompleteCallbackInput,
  type CreateCallbackInput,
  type ListCallbacksQuery,
  type UpdateCallbackInput,
} from "./callback.schema.js";
import {
  DEFAULT_CALLBACK_OPTIONS,
  type CallbackDto,
  type CallbackOptions,
  type CallbackStatus,
} from "./callback.types.js";

/** The slice of the notification service this module needs. */
export interface CallbackNotifier {
  notifyAgent(input: NotifyAgentInput): Promise<boolean>;
}

const BATCH = 100;
const OPEN: CallbackStatus[] = ["PENDING", "MISSED"];

/**
 * Callbacks an agent schedules with a customer. The assignee gets a reminder shortly before, and a callback nobody
 * handled shortly after its time is marked MISSED. Notes are internal (staff only), so a callback is visible to the
 * same people as the conversation's internal notes, plus its assignee and creator.
 */
export class CallbackService {
  constructor(
    private readonly repository: CallbackRepository,
    private readonly conversations: () => ConversationAccess,
    private readonly directory: Directory,
    private readonly notifications: CallbackNotifier,
    private readonly realtime: RealtimeNotifier,
    private readonly options: CallbackOptions = DEFAULT_CALLBACK_OPTIONS,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async listForConversation(auth: AuthContext, conversationId: string): Promise<CallbackDto[]> {
    await this.conversations().requireVisible(auth, conversationId);
    return (await this.repository.listForConversation(conversationId)).map((row) => toCallback(row, auth));
  }

  /** My callbacks (assigned to me or scheduled by me), soonest first. Supervisors can ask for everyone's. */
  async list(auth: AuthContext, query: ListCallbacksQuery) {
    if (query.scope === "all" && !can(auth, "callbacks.view_all")) {
      throw new ForbiddenError("Only a supervisor can list everyone's callbacks");
    }
    const { items, total } = await this.repository.list(
      {
        status: query.status,
        involving: query.scope === "mine" ? auth.userId : undefined,
        from: query.from,
        to: query.to,
      },
      (query.page - 1) * query.size,
      query.size,
    );
    return { items: items.map((row) => toCallback(row, auth)), meta: pageMeta(total, query) };
  }

  async get(auth: AuthContext, callbackId: string): Promise<CallbackDto> {
    return toCallback(await this.requireAccess(auth, callbackId), auth);
  }

  /** Anyone who can see the conversation may schedule one. It defaults to the owner (or the caller when unowned). */
  async create(auth: AuthContext, conversationId: string, input: CreateCallbackInput): Promise<CallbackDto> {
    const conversation = await this.conversations().requireVisible(auth, conversationId);
    if (conversation.customerId === null) throw new ConflictError("This conversation has no customer to call back");
    this.checkTime(input.scheduledAt);
    const assignee = input.assignedAgentId ?? conversation.assignedAgentId ?? auth.userId;
    if (assignee !== auth.userId) await this.checkAssignee(conversationId, assignee);

    const row = await this.repository.inTransaction(async (tx) => {
      if ((await tx.countPending(conversationId)) >= MAX_PENDING_PER_CONVERSATION) {
        throw new ConflictError(`A conversation can have at most ${MAX_PENDING_PER_CONVERSATION} pending callbacks`);
      }
      const created = await tx.create({
        conversationId,
        customerId: conversation.customerId as string,
        assignedAgentId: assignee,
        createdBy: auth.userId,
        scheduledAt: input.scheduledAt,
        notes: input.notes ?? null,
      });
      await tx.addActivity(conversationId, { type: "AGENT", id: auth.userId }, "Callback scheduled", {
        callbackId: created.id,
        action: "created",
        scheduledAt: created.scheduledAt.toISOString(),
      });
      return created;
    });
    await this.tellAssignee(auth, row, "Callback scheduled for you");
    return this.announce("callback.created", row, auth);
  }

  /** Reschedule, change the notes or hand it to another agent. Only open callbacks; assignee, creator or supervisor. */
  async update(auth: AuthContext, callbackId: string, input: UpdateCallbackInput): Promise<CallbackDto> {
    const existing = await this.requireManageable(auth, callbackId);
    if (input.scheduledAt) this.checkTime(input.scheduledAt);
    const newAssignee =
      input.assignedAgentId !== undefined && input.assignedAgentId !== existing.assignedAgentId
        ? input.assignedAgentId
        : undefined;
    if (newAssignee !== undefined && newAssignee !== auth.userId) {
      await this.checkAssignee(existing.conversationId, newAssignee);
    }

    const row = await this.repository.inTransaction(async (tx) => {
      const updated = await tx.reopenWith(callbackId, {
        ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(newAssignee !== undefined ? { assignedAgentId: newAssignee } : {}),
      });
      if (!updated) throw new ConflictError("This callback is already closed");
      await tx.addActivity(existing.conversationId, { type: "AGENT", id: auth.userId }, "Callback updated", {
        callbackId,
        action: input.scheduledAt ? "rescheduled" : "updated",
        scheduledAt: updated.scheduledAt.toISOString(),
      });
      return updated;
    });
    if (newAssignee !== undefined) await this.tellAssignee(auth, row, "Callback assigned to you");
    return this.announce("callback.updated", row, auth);
  }

  /** PENDING or MISSED to COMPLETED, with an optional note about the call. */
  async complete(auth: AuthContext, callbackId: string, input: CompleteCallbackInput): Promise<CallbackDto> {
    const existing = await this.requireManageable(auth, callbackId);
    const row = await this.repository.inTransaction(async (tx) => {
      const done = await tx.complete(callbackId, input.completionNote ?? null);
      if (!done) throw new ConflictError("This callback is already closed");
      await tx.addActivity(existing.conversationId, { type: "AGENT", id: auth.userId }, "Callback completed", {
        callbackId,
        action: "completed",
      });
      return done;
    });
    return this.announce("callback.completed", row, auth);
  }

  async cancel(auth: AuthContext, callbackId: string): Promise<CallbackDto> {
    const existing = await this.requireManageable(auth, callbackId);
    const row = await this.repository.inTransaction(async (tx) => {
      const cancelled = await tx.cancel(callbackId);
      if (!cancelled) throw new ConflictError("This callback is already closed");
      await tx.addActivity(existing.conversationId, { type: "AGENT", id: auth.userId }, "Callback cancelled", {
        callbackId,
        action: "cancelled",
      });
      return cancelled;
    });
    return this.announce("callback.cancelled", row, auth);
  }

  /**
   * One pass of the background job: marks overdue callbacks MISSED and sends reminders for those due soon. Safe to
   * run on several API instances and to repeat: every callback is claimed in the database, so each is reminded once
   * and marked missed once. A reminder is therefore at most once: if sending fails it is logged, not retried.
   */
  async processDue(now: Date = this.clock()): Promise<{ missed: number; reminded: number }> {
    const overdueBefore = new Date(now.getTime() - this.options.missedAfterMs);
    const missed = await this.repository.claimMissed(overdueBefore, BATCH);
    for (const row of missed) await this.handleMissed(row);

    // Callbacks already past their time but still inside the grace period are reminded too ("starting now").
    const dueBefore = new Date(now.getTime() + this.options.reminderLeadMs);
    const reminders = await this.repository.claimReminders(dueBefore, overdueBefore, BATCH);
    for (const row of reminders) await this.handleReminder(row);
    return { missed: missed.length, reminded: reminders.length };
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async handleMissed(row: CallbackRow) {
    await bestEffort("callback missed activity", () =>
      this.repository.addActivity(row.conversationId, { type: "SYSTEM", id: null }, "Callback missed", {
        callbackId: row.id,
        action: "missed",
      }),
    );
    await this.tellAssignee(null, row, "Missed callback");
    await bestEffort("realtime callback.missed", () =>
      this.realtime.messageEvent(idToString(row.conversationId), "callback.missed", { callback: toPublic(row) }),
    );
  }

  private async handleReminder(row: CallbackRow) {
    if (row.assignedAgentId === null) return;
    await this.tellAssignee(null, row, "Callback reminder");
    await bestEffort("realtime callback.reminder", () =>
      this.realtime.agentEvent(row.assignedAgentId as string, "callback.reminder", { callback: toPublic(row) }),
    );
  }

  /** Stores a CALLBACK notification for the assignee (never for the agent who made the change themselves). */
  private async tellAssignee(actor: AuthContext | null, row: CallbackRow, title: string) {
    if (row.assignedAgentId === null || row.assignedAgentId === actor?.userId) return;
    await bestEffort("callback notification", async () => {
      await this.notifications.notifyAgent({
        agentId: row.assignedAgentId as string,
        type: "CALLBACK",
        title,
        body: `${row.scheduledAt.toISOString()}${row.notes ? `: ${row.notes.slice(0, 120)}` : ""}`,
        conversationId: row.conversationId,
      });
    });
  }

  private async announce(type: string, row: CallbackRow, auth: AuthContext): Promise<CallbackDto> {
    await bestEffort(`realtime ${type}`, () =>
      this.realtime.messageEvent(idToString(row.conversationId), type, { callback: toPublic(row) }),
    );
    return toCallback(row, auth);
  }

  private checkTime(at: Date) {
    const now = this.clock().getTime();
    if (at.getTime() <= now) throw new BadRequestError("scheduledAt must be in the future");
    if (at.getTime() > now + MAX_SCHEDULE_AHEAD_DAYS * 86_400_000) {
      throw new BadRequestError(`scheduledAt can be at most ${MAX_SCHEDULE_AHEAD_DAYS} days ahead`);
    }
  }

  /** A callback the caller may read: staff on it directly, or anyone who can see its conversation. */
  private async requireAccess(auth: AuthContext, callbackId: string): Promise<CallbackRow> {
    const row = await this.repository.findById(callbackId);
    if (!row) throw new NotFoundError("Callback not found");
    if (!can(auth, "callbacks.view_all") && !involved(auth, row)) {
      await this.conversations().requireVisible(auth, row.conversationId);
    }
    return row;
  }

  private async requireManageable(auth: AuthContext, callbackId: string): Promise<CallbackRow> {
    const row = await this.requireAccess(auth, callbackId);
    if (!can(auth, "callbacks.manage_all") && !involved(auth, row)) {
      throw new ForbiddenError("Only the assignee, the creator or a supervisor can change a callback");
    }
    if (!OPEN.includes(row.status as CallbackStatus)) throw new ConflictError("This callback is already closed");
    return row;
  }

  /** The assignee must exist in Backend 1 and be able to open the conversation (as a plain agent, like mentions). */
  private async checkAssignee(conversationId: string, agentId: string) {
    let known;
    try {
      known = await this.directory.getAgents([agentId]);
    } catch (error) {
      logger.warn({ err: error }, "agent directory unavailable while checking a callback assignee");
      throw new ServiceUnavailableError("Agent directory is unavailable; try again shortly");
    }
    if (!known.some((agent) => agent.id === agentId)) {
      throw new BadRequestError("Unknown agent in assignedAgentId", { agentIds: [agentId] });
    }
    try {
      await this.conversations().requireVisible({ userId: agentId, role: "AGENT" }, conversationId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      throw new BadRequestError("That agent cannot see this conversation", { agentIds: [agentId] });
    }
  }
}

const involved = (auth: AuthContext, row: CallbackRow) =>
  row.assignedAgentId === auth.userId || row.createdBy === auth.userId;

function toPublic(row: CallbackRow): Omit<CallbackDto, "permissions"> {
  return {
    id: idToString(row.id),
    conversationId: idToString(row.conversationId),
    customerId: idToString(row.customerId),
    assignedAgentId: row.assignedAgentId === null ? null : idToString(row.assignedAgentId),
    createdBy: row.createdBy === null ? null : idToString(row.createdBy),
    scheduledAt: row.scheduledAt.toISOString(),
    status: row.status as CallbackStatus,
    notes: row.notes,
    completionNote: row.completionNote,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
  };
}

function toCallback(row: CallbackRow, auth: AuthContext): CallbackDto {
  const open = OPEN.includes(row.status as CallbackStatus);
  const manages = open && (can(auth, "callbacks.manage_all") || involved(auth, row));
  return { ...toPublic(row), permissions: { canEdit: manages, canComplete: manages, canCancel: manages } };
}
