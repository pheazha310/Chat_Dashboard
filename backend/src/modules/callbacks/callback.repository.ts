import { prisma, runInTransaction, type Db } from "@config/database.js";
import type { Prisma } from "../../../prisma/generated/prisma/client.js";
import type { CallbackRequest } from "../../../prisma/generated/prisma/client.js";
import type { CallbackStatus } from "./callback.types.js";

export type CallbackRow = CallbackRequest;

export interface ListFilter {
  status?: CallbackStatus | undefined;
  /** Rows assigned to or created by this agent. Omit for everything (supervisors). */
  involving?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export class CallbackRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: CallbackRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new CallbackRepository(tx)));
  }

  findById(id: string): Promise<CallbackRow | null> {
    return this.db.callbackRequest.findUnique({ where: { id } });
  }

  listForConversation(conversationId: string): Promise<CallbackRow[]> {
    return this.db.callbackRequest.findMany({
      where: { conversationId },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    });
  }

  async list(filter: ListFilter, skip: number, take: number) {
    const where: Prisma.CallbackRequestWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.involving ? { OR: [{ assignedAgentId: filter.involving }, { createdBy: filter.involving }] } : {}),
      ...(filter.from || filter.to
        ? { scheduledAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.callbackRequest.findMany({ where, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], skip, take }),
      this.db.callbackRequest.count({ where }),
    ]);
    return { items, total };
  }

  countPending(conversationId: string) {
    return this.db.callbackRequest.count({ where: { conversationId, status: "PENDING" } });
  }

  create(data: {
    conversationId: string;
    customerId: string;
    assignedAgentId: string;
    createdBy: string;
    scheduledAt: Date;
    notes: string | null;
  }) {
    return this.db.callbackRequest.create({ data });
  }

  /**
   * Changes an open callback (PENDING or MISSED). A rescheduled callback is PENDING again and may remind again.
   * Returns null when it is no longer open, so two people changing it at once cannot both win.
   */
  async reopenWith(
    id: string,
    data: { scheduledAt?: Date; notes?: string | null; assignedAgentId?: string },
  ): Promise<CallbackRow | null> {
    const rescheduled = data.scheduledAt !== undefined;
    const { count } = await this.db.callbackRequest.updateMany({
      where: { id, status: { in: ["PENDING", "MISSED"] } },
      data: {
        ...data,
        ...(rescheduled ? { status: "PENDING", reminderSentAt: null } : {}),
        // A new assignee has not been reminded yet.
        ...(data.assignedAgentId !== undefined ? { reminderSentAt: null } : {}),
      },
    });
    return count === 1 ? this.findById(id) : null;
  }

  /** PENDING or MISSED to COMPLETED. Null if it was already closed. */
  async complete(id: string, completionNote: string | null): Promise<CallbackRow | null> {
    const { count } = await this.db.callbackRequest.updateMany({
      where: { id, status: { in: ["PENDING", "MISSED"] } },
      data: { status: "COMPLETED", completionNote, completedAt: new Date() },
    });
    return count === 1 ? this.findById(id) : null;
  }

  /** PENDING or MISSED to CANCELLED. Null if it was already closed. */
  async cancel(id: string): Promise<CallbackRow | null> {
    const { count } = await this.db.callbackRequest.updateMany({
      where: { id, status: { in: ["PENDING", "MISSED"] } },
      data: { status: "CANCELLED" },
    });
    return count === 1 ? this.findById(id) : null;
  }

  /**
   * Marks overdue PENDING callbacks MISSED and returns them. The rows are locked with SKIP LOCKED inside the one
   * statement, so several API instances running the job at once each get a different set and none twice.
   */
  async claimMissed(overdueBefore: Date, limit: number): Promise<CallbackRow[]> {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      UPDATE callback_requests SET status = 'MISSED'
       WHERE id IN (
         SELECT id FROM callback_requests
          WHERE status = 'PENDING' AND scheduled_at < ${overdueBefore}
          ORDER BY scheduled_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    return this.byIds(rows.map((row) => row.id));
  }

  /** Stamps `reminder_sent_at` on callbacks due soon and returns them: each callback is claimed once, by one instance. */
  async claimReminders(dueBefore: Date, notBefore: Date, limit: number): Promise<CallbackRow[]> {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      UPDATE callback_requests SET reminder_sent_at = now()
       WHERE id IN (
         SELECT id FROM callback_requests
          WHERE status = 'PENDING' AND reminder_sent_at IS NULL AND assigned_agent_id IS NOT NULL
            AND scheduled_at <= ${dueBefore} AND scheduled_at >= ${notBefore}
          ORDER BY scheduled_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    return this.byIds(rows.map((row) => row.id));
  }

  private byIds(ids: string[]): Promise<CallbackRow[]> {
    return ids.length === 0
      ? Promise.resolve([])
      : this.db.callbackRequest.findMany({ where: { id: { in: ids } }, orderBy: { scheduledAt: "asc" } });
  }

  async addActivity(
    conversationId: string,
    actor: { type: "AGENT" | "SYSTEM"; id: string | null },
    description: string,
    metadata: Record<string, string>,
  ) {
    await this.db.conversationActivity.create({
      data: {
        conversationId,
        actorType: actor.type,
        actorId: actor.id,
        activityType: "CALLBACK",
        description,
        metadata,
      },
    });
  }
}
