import { prisma, runInTransaction, type Db } from "@config/database.js";
import type { Prisma } from "../../../prisma/generated/prisma/client.js";
import type { ConversationState } from "./assignment.types.js";

export class AssignmentRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: AssignmentRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new AssignmentRepository(tx)));
  }

  findState(id: string): Promise<ConversationState | null> {
    return this.db.conversation.findUnique({
      where: { id },
      select: { id: true, status: true, handoffStatus: true, assignedAgentId: true, isArchived: true },
    });
  }

  /**
   * Makes `agentId` the owner only if the conversation is still in the state the caller decided from. Of two agents
   * clicking at once, one update matches and the other gets false (no read-then-write race).
   */
  async claim(state: ConversationState, agentId: string): Promise<boolean> {
    const { count } = await this.db.conversation.updateMany({
      where: {
        id: state.id,
        handoffStatus: state.handoffStatus,
        assignedAgentId: state.assignedAgentId,
        status: { not: "CLOSED" },
      },
      data: { conversationMode: "HUMAN", handoffStatus: "ASSIGNED", assignedAgentId: agentId },
    });
    return count === 1;
  }

  /** Puts an owned conversation back in the shared queue; false if the owner changed meanwhile. */
  async release(state: ConversationState): Promise<boolean> {
    const { count } = await this.db.conversation.updateMany({
      where: { id: state.id, handoffStatus: "ASSIGNED", assignedAgentId: state.assignedAgentId },
      data: { handoffStatus: "NEEDS_HUMAN", assignedAgentId: null },
    });
    return count === 1;
  }

  async endOwner(conversationId: string, endedBy: string): Promise<void> {
    await this.db.conversationAssignment.updateMany({
      where: { conversationId, endedAt: null, assignmentType: "OWNER" },
      data: { endedAt: new Date(), endedBy },
    });
  }

  createOwner(data: { conversationId: string; agentId: string; assignedBy: string; action: string; note?: string }) {
    return this.db.conversationAssignment.create({
      data: {
        conversationId: data.conversationId,
        agentId: data.agentId,
        assignedBy: data.assignedBy,
        assignmentType: "OWNER",
        assignmentAction: data.action,
        note: data.note ?? null,
      },
    });
  }

  async leaveParticipant(conversationId: string, agentId: string): Promise<void> {
    await this.db.conversationParticipant.updateMany({
      where: { conversationId, participantType: "AGENT", participantId: agentId, leftAt: null },
      data: { leftAt: new Date() },
    });
  }

  /** Adds the agent as an OWNER participant, promoting an existing active row (e.g. a viewer) instead of duplicating. */
  async joinAsOwner(conversationId: string, agentId: string): Promise<void> {
    const { count } = await this.db.conversationParticipant.updateMany({
      where: { conversationId, participantType: "AGENT", participantId: agentId, leftAt: null },
      data: { participantRole: "OWNER" },
    });
    if (count === 0) {
      await this.db.conversationParticipant.create({
        data: { conversationId, participantType: "AGENT", participantId: agentId, participantRole: "OWNER" },
      });
    }
  }

  addActivity(data: Prisma.ConversationActivityUncheckedCreateInput) {
    return this.db.conversationActivity.create({ data });
  }

  history(conversationId: string) {
    return this.db.conversationAssignment.findMany({
      where: { conversationId },
      orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    });
  }
}
