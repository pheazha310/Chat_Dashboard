import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { can } from "@shared/auth/permissions.js";
import { isOwner } from "@shared/policy/conversation-access.js";
import type { ConversationAccess } from "@shared/ports/conversation-access.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import type { ConversationEscalation } from "../../../prisma/generated/prisma/client.js";
import type { EscalationRepository } from "./escalation.repository.js";
import type { CreateEscalationInput, UpdateEscalationInput } from "./escalation.schema.js";
import type { EscalationDto, EscalationStatus } from "./escalation.types.js";

/**
 * An agent asks for a supervisor's attention on a conversation. It records the request, its outcome and a timeline
 * entry, and tells everyone who can see the conversation. It does not change the conversation's owner, status or
 * priority: what a supervisor then does (take over, reassign, resolve) uses the normal assignment endpoints.
 */
export class EscalationService {
  constructor(
    private readonly repository: EscalationRepository,
    private readonly conversations: () => ConversationAccess,
    private readonly realtime: RealtimeNotifier,
  ) {}

  async list(auth: AuthContext, conversationId: string) {
    await this.conversations().requireVisible(auth, conversationId);
    return (await this.repository.list(conversationId)).map(toEscalation);
  }

  /** Only the agent who owns an open conversation can escalate it, and only one escalation can be pending. */
  async escalate(auth: AuthContext, conversationId: string, input: CreateEscalationInput): Promise<EscalationDto> {
    const state = await this.conversations().requireVisible(auth, conversationId);
    if (!isOwner(auth, state) || state.status === "CLOSED") {
      throw new ForbiddenError("Only the agent who owns an open conversation can escalate it");
    }
    const created = await this.repository.inTransaction(async (tx) => {
      const row = await tx.openPending(conversationId, auth.userId, input.reason ?? null);
      if (!row) throw new ConflictError("This conversation already has a pending escalation");
      await tx.addActivity(conversationId, auth.userId, "Conversation escalated", {
        escalationId: row.id,
        action: "requested",
      });
      return row;
    });
    const dto = toEscalation(created);
    await this.publish(dto);
    return dto;
  }

  /**
   * Supervisors and admins resolve a pending escalation; its requester or a supervisor can cancel it. A closed
   * escalation cannot change again (409), which also settles two people answering at the same time.
   */
  async close(auth: AuthContext, escalationId: string, input: UpdateEscalationInput): Promise<EscalationDto> {
    const existing = await this.repository.findById(escalationId);
    if (!existing) throw new NotFoundError("Escalation not found");
    await this.conversations().requireVisible(auth, existing.conversationId);

    const requester = existing.requestedBy === auth.userId;
    const allowed =
      input.status === "RESOLVED" ? can(auth, "escalations.resolve") : can(auth, "escalations.manage_all") || requester;
    if (!allowed) {
      throw new ForbiddenError(
        input.status === "RESOLVED"
          ? "Only a supervisor can resolve an escalation"
          : "Only the requester or a supervisor can cancel it",
      );
    }
    const closed = await this.repository.inTransaction(async (tx) => {
      const row = await tx.close(escalationId, input.status, auth.userId);
      if (!row) throw new ConflictError("This escalation is already closed");
      await tx.addActivity(existing.conversationId, auth.userId, `Escalation ${input.status.toLowerCase()}`, {
        escalationId,
        action: input.status.toLowerCase(),
      });
      return row;
    });
    const dto = toEscalation(closed);
    await this.publish(dto);
    return dto;
  }

  private publish(escalation: EscalationDto) {
    return bestEffort("realtime conversation.escalated", () =>
      this.realtime.messageEvent(escalation.conversationId, "conversation.escalated", { escalation }),
    );
  }
}

const toEscalation = (row: ConversationEscalation): EscalationDto => ({
  id: idToString(row.id),
  conversationId: idToString(row.conversationId),
  requestedBy: idToString(row.requestedBy),
  reason: row.reason,
  status: row.status as EscalationStatus,
  resolvedBy: row.resolvedBy === null ? null : idToString(row.resolvedBy),
  createdAt: row.createdAt.toISOString(),
  resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
});
