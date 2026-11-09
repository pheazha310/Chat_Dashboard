import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { can } from "@shared/auth/permissions.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import type { SystemMessagePort } from "@shared/ports/system-message.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import { permissionsFor } from "@shared/policy/conversation-access.js";
import type { NotificationService } from "@modules/notifications/index.js";
import type { AssignmentRepository } from "./assignment.repository.js";
import type { AssignInput } from "./assignment.schema.js";
import type { AssignmentDto, AssignmentRow, ConversationState } from "./assignment.types.js";

const STALE = "The conversation was changed by someone else; refresh and try again";

export class AssignmentService {
  constructor(
    private readonly repository: AssignmentRepository,
    private readonly notifications: NotificationService,
    private readonly systemMessages: SystemMessagePort,
    private readonly realtime: RealtimeNotifier,
  ) {}

  /** Self-assign (takeover) when `agentId` is omitted; assign to another agent (supervisors only) otherwise. */
  async assign(auth: AuthContext, conversationId: string, input: AssignInput) {
    const state = await this.load(auth, conversationId);
    const target = input.agentId ?? auth.userId;
    const permissions = permissionsFor(auth, state);

    if (state.status === "CLOSED") throw new ConflictError("Conversation is closed");
    if (state.assignedAgentId === target) throw new ConflictError("Conversation is already assigned to that agent");
    if (target === auth.userId ? !permissions.canTakeOver : !permissions.canAssignOthers) {
      throw new ForbiddenError(
        target === auth.userId
          ? "You cannot take over this conversation"
          : "Only supervisors can assign to other agents",
      );
    }

    const action = target === auth.userId ? "TAKEOVER" : state.assignedAgentId === null ? "ASSIGNED" : "TRANSFERRED";
    return this.changeOwner(auth, state, target, action, input.note);
  }

  /** The owner (or a supervisor) hands the conversation to another agent. */
  async transfer(auth: AuthContext, conversationId: string, input: { agentId: string; note?: string | undefined }) {
    const state = await this.load(auth, conversationId);
    if (state.status === "CLOSED") throw new ConflictError("Conversation is closed");
    if (!permissionsFor(auth, state).canTransfer) {
      throw new ForbiddenError("Only the current owner or a supervisor can transfer this conversation");
    }
    if (state.assignedAgentId === input.agentId)
      throw new ConflictError("Conversation is already assigned to that agent");
    return this.changeOwner(auth, state, input.agentId, "TRANSFERRED", input.note);
  }

  /** Releases the conversation back to the shared queue. */
  async unassign(auth: AuthContext, conversationId: string, input: { note?: string | undefined }) {
    const state = await this.load(auth, conversationId);
    if (!permissionsFor(auth, state).canUnassign) {
      throw new ForbiddenError("Only the current owner or a supervisor can unassign this conversation");
    }
    const previous = state.assignedAgentId;
    await this.repository.inTransaction(async (tx) => {
      if (!(await tx.release(state))) throw new ConflictError(STALE);
      await tx.endOwner(state.id, auth.userId);
      if (previous !== null) await tx.leaveParticipant(state.id, previous);
      await tx.addActivity({
        conversationId: state.id,
        actorType: "AGENT",
        actorId: auth.userId,
        activityType: "UNASSIGNED",
        description: input.note ?? "Conversation returned to the queue",
        metadata: { previousAgentId: previous === null ? null : idToString(previous) },
      });
    });
    await bestEffort("system message", () =>
      this.systemMessages.post(state.id, `Agent ${auth.userId} returned the conversation to the queue`, {
        event: "unassigned",
        actorId: idToString(auth.userId),
        previousAgentId: previous === null ? null : idToString(previous),
      }),
    );
    await bestEffort("realtime", () =>
      this.realtime.conversationEvent(
        state.id,
        "updated",
        { event: "unassigned", previousAgentId: previous === null ? null : idToString(previous) },
        previous === null ? [] : [previous],
      ),
    );
    if (previous !== null && previous !== auth.userId) {
      await this.notify(previous, "TRANSFERRED", "Conversation unassigned", state.id);
    }
    return { conversationId: idToString(state.id), assignedAgentId: null };
  }

  async history(auth: AuthContext, conversationId: string) {
    const state = await this.load(auth, conversationId);
    return (await this.repository.history(conversationId)).map(toAssignment);
  }

  private async changeOwner(
    auth: AuthContext,
    state: ConversationState,
    target: string,
    action: string,
    note: string | undefined,
  ) {
    const previous = state.assignedAgentId;
    const assignment = await this.repository.inTransaction(async (tx) => {
      // The conditional update decides the winner when two agents race; the database also refuses two open owners.
      if (!(await tx.claim(state, target))) throw new ConflictError(STALE);
      await tx.endOwner(state.id, auth.userId);
      if (previous !== null) await tx.leaveParticipant(state.id, previous);
      await tx.joinAsOwner(state.id, target);
      const created = await tx.createOwner({
        conversationId: state.id,
        agentId: target,
        assignedBy: auth.userId,
        action,
        ...(note === undefined ? {} : { note }),
      });
      await tx.addActivity({
        conversationId: state.id,
        actorType: "AGENT",
        actorId: auth.userId,
        activityType: previous === null ? "ASSIGNED" : "TRANSFERRED",
        description: previous === null ? "Conversation assigned" : "Conversation transferred",
        metadata: {
          agentId: idToString(target),
          previousAgentId: previous === null ? null : idToString(previous),
          action,
        },
      });
      return created;
    });

    const type = previous === null ? "ASSIGNED" : "TRANSFERRED";
    const who = `Agent ${auth.userId}`;
    const text =
      action === "TAKEOVER"
        ? `${who} took over the conversation`
        : `${who} ${type === "ASSIGNED" ? "assigned" : "transferred"} the conversation to agent ${target}`;
    await bestEffort("system message", () =>
      this.systemMessages.post(state.id, text, {
        event: action.toLowerCase(),
        actorId: idToString(auth.userId),
        agentId: idToString(target),
        previousAgentId: previous === null ? null : idToString(previous),
      }),
    );
    await bestEffort("realtime", () =>
      this.realtime.conversationEvent(
        state.id,
        type === "ASSIGNED" ? "assigned" : "transferred",
        {
          agentId: idToString(target),
          previousAgentId: previous === null ? null : idToString(previous),
          assignedBy: idToString(auth.userId),
          action,
        },
        previous === null ? [] : [previous],
      ),
    );
    if (target !== auth.userId)
      await this.notify(target, type, `A conversation was ${type.toLowerCase()} to you`, state.id);
    if (previous !== null && previous !== auth.userId && previous !== target) {
      await this.notify(previous, "TRANSFERRED", "A conversation was transferred away from you", state.id);
    }
    return toAssignment(assignment);
  }

  /** Another agent's assigned conversation looks missing, as in the conversations module, so existence is not leaked. */
  private async load(auth: AuthContext, id: string): Promise<ConversationState> {
    const state = await this.repository.findState(id);
    const hidden =
      state?.handoffStatus === "ASSIGNED" &&
      !can(auth, "conversations.view_all") &&
      state.assignedAgentId !== auth.userId;
    if (!state || hidden) throw new NotFoundError(`Conversation ${idToString(id)} not found`);
    return state;
  }

  /** Best effort: the ownership change is already committed, so a notification failure must not undo or fail it. */
  private notify(agentId: string, type: "ASSIGNED" | "TRANSFERRED", title: string, conversationId: string) {
    return bestEffort("notification", () => this.notifications.notifyAgent({ agentId, type, title, conversationId }));
  }
}

// ─── DTO mapping ───────────────────────────────────────────────────────────

const nullableId = (value: string | null) => (value === null ? null : idToString(value));

const toAssignment = (row: AssignmentRow): AssignmentDto => ({
  id: idToString(row.id),
  conversationId: idToString(row.conversationId),
  agentId: idToString(row.agentId),
  assignedBy: nullableId(row.assignedBy),
  type: row.assignmentType,
  action: row.assignmentAction,
  note: row.note,
  assignedAt: row.assignedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
  endedBy: nullableId(row.endedBy),
});
