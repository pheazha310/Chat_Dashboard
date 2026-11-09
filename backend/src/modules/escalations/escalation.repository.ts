import { prisma, runInTransaction, type Db } from "@config/database.js";
import type { ConversationEscalation } from "../../../prisma/generated/prisma/client.js";

export class EscalationRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: EscalationRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new EscalationRepository(tx)));
  }

  findById(id: string): Promise<ConversationEscalation | null> {
    return this.db.conversationEscalation.findUnique({ where: { id } });
  }

  list(conversationId: string): Promise<ConversationEscalation[]> {
    return this.db.conversationEscalation.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  /**
   * Opens a PENDING escalation, or returns null when the conversation already has one. The partial unique index
   * decides, so two simultaneous requests cannot both win, and a loser does not abort the transaction.
   */
  async openPending(conversationId: string, requestedBy: string, reason: string | null) {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      INSERT INTO conversation_escalations (conversation_id, requested_by, reason, status, created_at)
      VALUES (${conversationId}::uuid, ${requestedBy}::uuid, ${reason}, 'PENDING', now())
      ON CONFLICT (conversation_id) WHERE status = 'PENDING' DO NOTHING
      RETURNING id`;
    const id = rows[0]?.id;
    return id === undefined ? null : this.db.conversationEscalation.findUniqueOrThrow({ where: { id } });
  }

  /** Closes a PENDING escalation. Returns null if it was already closed by someone else. */
  async close(id: string, status: "RESOLVED" | "CANCELLED", by: string) {
    const { count } = await this.db.conversationEscalation.updateMany({
      where: { id, status: "PENDING" },
      data: { status, resolvedBy: by, resolvedAt: new Date() },
    });
    return count === 1 ? this.db.conversationEscalation.findUniqueOrThrow({ where: { id } }) : null;
  }

  async addActivity(conversationId: string, agentId: string, description: string, metadata: Record<string, string>) {
    await this.db.conversationActivity.create({
      data: { conversationId, actorType: "AGENT", actorId: agentId, activityType: "ESCALATED", description, metadata },
    });
  }
}
