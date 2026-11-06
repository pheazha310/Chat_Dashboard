import { prisma, runInTransaction, type Db } from "@config/database.js";
import type { Prisma } from "../../../prisma/generated/prisma/client.js";
import type {
  BlockedKeyword,
  CustomerBlock,
  ModerationActivity,
  SpamReport,
} from "../../../prisma/generated/prisma/client.js";
import { escapeLike } from "@shared/utils/like.js";
import type { ModerationTarget } from "./moderation.types.js";

export class ModerationRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: ModerationRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new ModerationRepository(tx)));
  }

  // ─── blocks ────────────────────────────────────────────────────────────────

  async isBlocked(customerId: string): Promise<boolean> {
    return (await this.db.customerBlock.count({ where: { customerId, unblockedAt: null } })) > 0;
  }

  findActiveBlock(customerId: string): Promise<CustomerBlock | null> {
    return this.db.customerBlock.findFirst({ where: { customerId, unblockedAt: null } });
  }

  /** Creates the block, or returns null when the customer is already blocked (the partial unique index decides). */
  async block(customerId: string, blockedBy: string, reason: string | null): Promise<CustomerBlock | null> {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      INSERT INTO customer_blocks (customer_id, blocked_by, reason, blocked_at)
      VALUES (${customerId}::uuid, ${blockedBy}::uuid, ${reason}, now())
      ON CONFLICT (customer_id) WHERE unblocked_at IS NULL DO NOTHING
      RETURNING id`;
    const id = rows[0]?.id;
    return id === undefined ? null : this.db.customerBlock.findUniqueOrThrow({ where: { id } });
  }

  /** Lifts the current block. Null when the customer was not blocked. */
  async unblock(customerId: string, by: string): Promise<CustomerBlock | null> {
    const current = await this.findActiveBlock(customerId);
    if (!current) return null;
    const { count } = await this.db.customerBlock.updateMany({
      where: { id: current.id, unblockedAt: null },
      data: { unblockedAt: new Date(), unblockedBy: by },
    });
    return count === 1 ? this.db.customerBlock.findUniqueOrThrow({ where: { id: current.id } }) : null;
  }

  async listBlocks(active: boolean, blockedBy: string | undefined, skip: number, take: number) {
    const where: Prisma.CustomerBlockWhereInput = {
      unblockedAt: active ? null : { not: null },
      ...(blockedBy ? { blockedBy } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.customerBlock.findMany({ where, orderBy: [{ blockedAt: "desc" }, { id: "desc" }], skip, take }),
      this.db.customerBlock.count({ where }),
    ]);
    return { items, total };
  }

  // ─── keywords ──────────────────────────────────────────────────────────────

  activeKeywords(): Promise<BlockedKeyword[]> {
    return this.db.blockedKeyword.findMany({ where: { isActive: true } });
  }

  countActiveKeywords() {
    return this.db.blockedKeyword.count({ where: { isActive: true } });
  }

  findKeyword(id: string): Promise<BlockedKeyword | null> {
    return this.db.blockedKeyword.findUnique({ where: { id } });
  }

  async findKeywordByText(keyword: string): Promise<BlockedKeyword | null> {
    const rows = await this.db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM blocked_keywords WHERE lower(keyword) = lower(${keyword})`;
    const id = rows[0]?.id;
    return id === undefined ? null : this.findKeyword(id);
  }

  async listKeywords(q: string | undefined, skip: number, take: number) {
    const where: Prisma.BlockedKeywordWhereInput = q
      ? { keyword: { contains: escapeLike(q), mode: "insensitive" } }
      : {};
    const [items, total] = await Promise.all([
      this.db.blockedKeyword.findMany({ where, orderBy: [{ keyword: "asc" }, { id: "asc" }], skip, take }),
      this.db.blockedKeyword.count({ where }),
    ]);
    return { items, total };
  }

  createKeyword(keyword: string, createdBy: string) {
    return this.db.blockedKeyword.create({ data: { keyword, createdBy } });
  }

  updateKeyword(id: string, data: { keyword?: string; isActive?: boolean }) {
    return this.db.blockedKeyword.update({ where: { id }, data });
  }

  async deleteKeyword(id: string): Promise<boolean> {
    const { count } = await this.db.blockedKeyword.deleteMany({ where: { id } });
    return count > 0;
  }

  // ─── spam reports ──────────────────────────────────────────────────────────

  findReport(id: string): Promise<SpamReport | null> {
    return this.db.spamReport.findUnique({ where: { id } });
  }

  /** Creates a PENDING report, or null when this reporter already has one pending for it (the unique index decides). */
  async openReport(input: {
    conversationId: string;
    reportedByType: "AGENT" | "CUSTOMER";
    reportedById: string;
    messageId: string | null;
    reason: string;
  }): Promise<SpamReport | null> {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      INSERT INTO spam_reports (conversation_id, reported_by_type, reported_by_id, message_id, reason, status, created_at)
      VALUES (${input.conversationId}::uuid, ${input.reportedByType}, ${input.reportedById}::uuid,
              ${input.messageId}::uuid, ${input.reason}, 'PENDING', now())
      ON CONFLICT DO NOTHING
      RETURNING id`;
    const id = rows[0]?.id;
    return id === undefined ? null : this.db.spamReport.findUniqueOrThrow({ where: { id } });
  }

  /** PENDING to CONFIRMED or DISMISSED. Null when someone reviewed it first. */
  async review(id: string, status: "CONFIRMED" | "DISMISSED", by: string, note: string | null) {
    const { count } = await this.db.spamReport.updateMany({
      where: { id, status: "PENDING" },
      data: { status, reviewedBy: by, reviewedAt: new Date(), resolutionNote: note },
    });
    return count === 1 ? this.db.spamReport.findUniqueOrThrow({ where: { id } }) : null;
  }

  async listReports(
    filter: { status?: string | undefined; reportedById?: string | undefined; conversationId?: string | undefined },
    skip: number,
    take: number,
  ) {
    const where: Prisma.SpamReportWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.reportedById ? { reportedById: filter.reportedById } : {}),
      ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.spamReport.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take }),
      this.db.spamReport.count({ where }),
    ]);
    return { items, total };
  }

  // ─── audit ─────────────────────────────────────────────────────────────────

  record(
    actorId: string,
    action: string,
    targetType: ModerationTarget,
    targetId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.db.moderationActivity.create({
      data: { actorId, action, targetType, targetId, ...(metadata === undefined ? {} : { metadata }) },
    });
  }

  async listActivities(
    filter: { targetType?: string | undefined; actorId?: string | undefined },
    skip: number,
    take: number,
  ) {
    const where: Prisma.ModerationActivityWhereInput = {
      ...(filter.targetType ? { targetType: filter.targetType } : {}),
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.moderationActivity.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take }),
      this.db.moderationActivity.count({ where }),
    ]);
    return { items, total } as { items: ModerationActivity[]; total: number };
  }

  /** A timeline entry on the conversation (shown in GET /conversations/:id/activities). */
  async addConversationActivity(
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
        activityType: "MODERATION",
        description,
        metadata,
      },
    });
  }
}
