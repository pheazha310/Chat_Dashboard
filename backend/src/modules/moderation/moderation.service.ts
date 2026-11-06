import { ConflictError, ForbiddenError, NotFoundError, BadRequestError } from "@shared/errors/AppError.js";
import { isSupervisor, type AuthContext } from "@shared/auth/auth.types.js";
import { isOwner } from "@shared/policy/conversation-access.js";
import type { ConversationAccess, CustomerConversationAccess } from "@shared/ports/conversation-access.js";
import type { Directory } from "@shared/ports/directory.js";
import type { CustomerGuard, MessageLookup } from "@shared/ports/moderation.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import { pageMeta, type PageQuery } from "@shared/utils/pagination.js";
import type {
  BlockedKeyword,
  CustomerBlock,
  ModerationActivity,
  SpamReport,
} from "../../../prisma/generated/prisma/client.js";
import type { ModerationRepository } from "./moderation.repository.js";
import {
  MAX_ACTIVE_KEYWORDS,
  type BlockInput,
  type ListActivitiesQuery,
  type ListBlocksQuery,
  type ListKeywordsQuery,
  type ListReportsQuery,
  type ReportSpamInput,
  type ReviewReportInput,
  type UpdateKeywordInput,
} from "./moderation.schema.js";
import type {
  BlockDto,
  KeywordDto,
  ModerationActivityDto,
  ModerationTarget,
  SpamReportDto,
  SpamStatus,
} from "./moderation.types.js";

type Access = ConversationAccess & CustomerConversationAccess;

/** How long a process remembers the active keyword list. Another instance sees a change within this time. */
const KEYWORD_CACHE_MS = 15_000;

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

/**
 * Blocked customers, blocked keywords and spam reports, with an audit trail.
 *
 * Blocking a customer stops what the customer does (messages, calls) once the customer channel exists; agents can
 * still write to a blocked customer's conversation, and open conversations are not closed. A blocked keyword never
 * rejects a message: legitimate loan questions would be lost. A matching message is stored and flagged for review.
 */
export class ModerationService implements CustomerGuard {
  private keywordCache: { loadedAt: number; keywords: { id: string; text: string }[] } | null = null;

  constructor(
    private readonly repository: ModerationRepository,
    private readonly conversations: () => Access,
    private readonly messages: () => MessageLookup,
    private readonly directory: Directory,
    private readonly realtime: RealtimeNotifier,
    private readonly clock: () => number = Date.now,
  ) {}

  // ─── the guard (used when a customer acts) ─────────────────────────────────

  isBlocked(customerId: string): Promise<boolean> {
    return this.repository.isBlocked(customerId);
  }

  async matchedKeywords(text: string): Promise<string[]> {
    const keywords = await this.loadKeywords();
    const haystack = text.toLowerCase();
    return keywords.filter((keyword) => haystack.includes(keyword.text)).map((keyword) => keyword.id);
  }

  // ─── blocks ────────────────────────────────────────────────────────────────

  /** The owner of the conversation, or a supervisor, blocks the customer it belongs to. */
  async blockFromConversation(auth: AuthContext, conversationId: string, input: BlockInput): Promise<BlockDto> {
    const state = await this.conversations().requireVisible(auth, conversationId);
    if (!isSupervisor(auth) && !isOwner(auth, state)) {
      throw new ForbiddenError("Only the agent who owns the conversation, or a supervisor, can block its customer");
    }
    if (state.customerId === null) throw new ConflictError("This conversation has no customer");
    return this.block(auth, state.customerId, input, conversationId);
  }

  async blockCustomer(auth: AuthContext, customerId: string, input: BlockInput): Promise<BlockDto> {
    this.requireSupervisor(auth, "Only a supervisor can block a customer directly");
    return this.block(auth, customerId, input, null);
  }

  /** A supervisor, or the agent who blocked the customer, lifts the block. Anyone else sees nothing to lift. */
  async unblock(auth: AuthContext, customerId: string): Promise<BlockDto> {
    const current = await this.repository.findActiveBlock(customerId);
    if (!current || (!isSupervisor(auth) && current.blockedBy !== auth.userId)) {
      throw new NotFoundError("This customer is not blocked");
    }
    const lifted = await this.repository.inTransaction(async (tx) => {
      const row = await tx.unblock(customerId, auth.userId);
      if (!row) throw new NotFoundError("This customer is not blocked");
      await tx.record(auth.userId, "UNBLOCK_CUSTOMER", "CUSTOMER", customerId);
      return row;
    });
    return this.presentBlock(lifted, auth, await this.names([lifted.customerId]));
  }

  /** Supervisors see every block; an agent sees the ones they made. */
  async listBlocks(auth: AuthContext, query: ListBlocksQuery) {
    const { items, total } = await this.repository.listBlocks(
      query.active,
      isSupervisor(auth) ? undefined : auth.userId,
      (query.page - 1) * query.size,
      query.size,
    );
    const names = await this.names(items.map((row) => row.customerId));
    return { items: items.map((row) => this.presentBlock(row, auth, names)), meta: pageMeta(total, query) };
  }

  // ─── keywords ──────────────────────────────────────────────────────────────

  async listKeywords(query: ListKeywordsQuery) {
    const { items, total } = await this.repository.listKeywords(query.q, (query.page - 1) * query.size, query.size);
    return { items: items.map(toKeyword), meta: pageMeta(total, query) };
  }

  async createKeyword(auth: AuthContext, keyword: string): Promise<KeywordDto> {
    this.requireSupervisor(auth, "Only a supervisor can manage blocked keywords");
    if ((await this.repository.countActiveKeywords()) >= MAX_ACTIVE_KEYWORDS) {
      throw new ConflictError(`At most ${MAX_ACTIVE_KEYWORDS} keywords can be active`);
    }
    if (await this.repository.findKeywordByText(keyword)) throw new ConflictError("This keyword already exists");
    try {
      const created = await this.repository.inTransaction(async (tx) => {
        const row = await tx.createKeyword(keyword, auth.userId);
        await tx.record(auth.userId, "ADD_KEYWORD", "KEYWORD", row.id, { keyword });
        return row;
      });
      this.keywordCache = null;
      return toKeyword(created);
    } catch (error) {
      // Two simultaneous requests for the same text: the unique index let one through.
      if (isUniqueViolation(error)) throw new ConflictError("This keyword already exists");
      throw error;
    }
  }

  async updateKeyword(auth: AuthContext, keywordId: string, input: UpdateKeywordInput): Promise<KeywordDto> {
    this.requireSupervisor(auth, "Only a supervisor can manage blocked keywords");
    const existing = await this.repository.findKeyword(keywordId);
    if (!existing) throw new NotFoundError("Keyword not found");
    if (input.keyword !== undefined) {
      const clash = await this.repository.findKeywordByText(input.keyword);
      if (clash && clash.id !== keywordId) throw new ConflictError("This keyword already exists");
    }
    if (input.isActive === true && !existing.isActive) {
      if ((await this.repository.countActiveKeywords()) >= MAX_ACTIVE_KEYWORDS) {
        throw new ConflictError(`At most ${MAX_ACTIVE_KEYWORDS} keywords can be active`);
      }
    }
    try {
      const updated = await this.repository.inTransaction(async (tx) => {
        const row = await tx.updateKeyword(keywordId, input);
        await tx.record(auth.userId, "UPDATE_KEYWORD", "KEYWORD", keywordId, {
          ...(input.keyword !== undefined ? { keyword: input.keyword, was: existing.keyword } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        });
        return row;
      });
      this.keywordCache = null;
      return toKeyword(updated);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError("This keyword already exists");
      throw error;
    }
  }

  async deleteKeyword(auth: AuthContext, keywordId: string): Promise<{ id: string }> {
    this.requireSupervisor(auth, "Only a supervisor can manage blocked keywords");
    const existing = await this.repository.findKeyword(keywordId);
    if (!existing) throw new NotFoundError("Keyword not found");
    await this.repository.inTransaction(async (tx) => {
      if (!(await tx.deleteKeyword(keywordId))) throw new NotFoundError("Keyword not found");
      await tx.record(auth.userId, "REMOVE_KEYWORD", "KEYWORD", keywordId, { keyword: existing.keyword });
    });
    this.keywordCache = null;
    return { id: idToString(keywordId) };
  }

  // ─── spam reports ──────────────────────────────────────────────────────────

  /** Anyone who can see the conversation may report it, or one of its messages. */
  async report(auth: AuthContext, conversationId: string, input: ReportSpamInput): Promise<SpamReportDto> {
    await this.conversations().requireVisible(auth, conversationId);
    await this.checkMessage(conversationId, input.messageId);
    const report = await this.repository.inTransaction(async (tx) => {
      const row = await tx.openReport({
        conversationId,
        reportedByType: "AGENT",
        reportedById: auth.userId,
        messageId: input.messageId ?? null,
        reason: input.reason,
      });
      if (!row) throw new ConflictError("You already have a pending report about this");
      await tx.record(auth.userId, "REPORT_SPAM", "SPAM_REPORT", row.id, {
        conversationId,
        ...(input.messageId ? { messageId: input.messageId } : {}),
      });
      await tx.addConversationActivity(conversationId, { type: "AGENT", id: auth.userId }, "Reported as spam", {
        reportId: row.id,
        action: "reported",
      });
      return row;
    });
    return this.announceReport("spam.reported", report);
  }

  /** The customer channel reports on behalf of a customer. There is no agent to put in the audit log. */
  async reportByCustomer(customerId: string, conversationId: string, input: ReportSpamInput): Promise<SpamReportDto> {
    await this.conversations().requireForCustomer(customerId, conversationId);
    await this.checkMessage(conversationId, input.messageId);
    const report = await this.repository.openReport({
      conversationId,
      reportedByType: "CUSTOMER",
      reportedById: customerId,
      messageId: input.messageId ?? null,
      reason: input.reason,
    });
    if (!report) throw new ConflictError("You already have a pending report about this");
    return this.announceReport("spam.reported", report);
  }

  /** Supervisors see every report; an agent sees the ones they filed. */
  async listReports(auth: AuthContext, query: ListReportsQuery) {
    const { items, total } = await this.repository.listReports(
      { status: query.status, reportedById: isSupervisor(auth) ? undefined : auth.userId },
      (query.page - 1) * query.size,
      query.size,
    );
    return { items: items.map(toReport), meta: pageMeta(total, query) };
  }

  async listReportsForConversation(auth: AuthContext, conversationId: string, query: PageQuery) {
    await this.conversations().requireVisible(auth, conversationId);
    const { items, total } = await this.repository.listReports(
      { conversationId },
      (query.page - 1) * query.size,
      query.size,
    );
    return { items: items.map(toReport), meta: pageMeta(total, query) };
  }

  /** Supervisors confirm or dismiss a pending report, optionally blocking the customer in the same step. */
  async review(auth: AuthContext, reportId: string, input: ReviewReportInput): Promise<SpamReportDto> {
    this.requireSupervisor(auth, "Only a supervisor can review spam reports");
    const existing = await this.repository.findReport(reportId);
    if (!existing) throw new NotFoundError("Spam report not found");
    if (input.blockCustomer && input.status !== "CONFIRMED") {
      throw new BadRequestError("blockCustomer only applies to a confirmed report");
    }
    const customerId = input.blockCustomer
      ? (await this.conversations().requireVisible(auth, existing.conversationId)).customerId
      : null;
    if (input.blockCustomer && customerId === null) throw new ConflictError("This conversation has no customer");

    const { report, blocked } = await this.repository.inTransaction(async (tx) => {
      const row = await tx.review(reportId, input.status, auth.userId, input.resolutionNote ?? null);
      if (!row) throw new ConflictError("This report was already reviewed");
      let didBlock = false;
      if (customerId !== null) {
        didBlock = (await tx.block(customerId, auth.userId, `Spam report ${reportId} confirmed`)) !== null;
        if (didBlock) await tx.record(auth.userId, "BLOCK_CUSTOMER", "CUSTOMER", customerId, { reportId });
      }
      await tx.record(
        auth.userId,
        input.status === "CONFIRMED" ? "CONFIRM_SPAM" : "DISMISS_SPAM",
        "SPAM_REPORT",
        reportId,
        {
          blockedCustomer: didBlock,
        },
      );
      await tx.addConversationActivity(
        existing.conversationId,
        { type: "AGENT", id: auth.userId },
        input.status === "CONFIRMED" ? "Spam report confirmed" : "Spam report dismissed",
        { reportId, action: input.status.toLowerCase() },
      );
      return { report: row, blocked: didBlock };
    });
    const dto = await this.announceReport("spam.reviewed", report);
    if (blocked && customerId !== null) {
      await bestEffort("realtime customer.blocked", () =>
        this.realtime.messageEvent(report.conversationId, "customer.blocked", {
          conversationId: idToString(report.conversationId),
          customerId: idToString(customerId),
        }),
      );
    }
    return dto;
  }

  // ─── audit log ─────────────────────────────────────────────────────────────

  async listActivities(auth: AuthContext, query: ListActivitiesQuery) {
    this.requireSupervisor(auth, "Only a supervisor can read the moderation log");
    const { items, total } = await this.repository.listActivities(
      { targetType: query.targetType, actorId: query.actorId },
      (query.page - 1) * query.size,
      query.size,
    );
    return { items: items.map(toActivity), meta: pageMeta(total, query) };
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private requireSupervisor(auth: AuthContext, message: string) {
    if (!isSupervisor(auth)) throw new ForbiddenError(message);
  }

  private async block(auth: AuthContext, customerId: string, input: BlockInput, conversationId: string | null) {
    const row = await this.repository.inTransaction(async (tx) => {
      const created = await tx.block(customerId, auth.userId, input.reason ?? null);
      if (!created) throw new ConflictError("This customer is already blocked");
      await tx.record(auth.userId, "BLOCK_CUSTOMER", "CUSTOMER", customerId, {
        ...(input.reason ? { reason: input.reason } : {}),
        ...(conversationId ? { conversationId } : {}),
      });
      if (conversationId) {
        await tx.addConversationActivity(conversationId, { type: "AGENT", id: auth.userId }, "Customer blocked", {
          action: "blocked",
        });
      }
      return created;
    });
    if (conversationId) {
      await bestEffort("realtime customer.blocked", () =>
        this.realtime.messageEvent(conversationId, "customer.blocked", {
          conversationId: idToString(conversationId),
          customerId: idToString(customerId),
        }),
      );
    }
    return this.presentBlock(row, auth, await this.names([customerId]));
  }

  private async checkMessage(conversationId: string, messageId: string | undefined) {
    if (messageId !== undefined && !(await this.messages().existsInConversation(conversationId, messageId))) {
      throw new BadRequestError("That message is not in this conversation", { messageId });
    }
  }

  private async announceReport(type: string, report: SpamReport): Promise<SpamReportDto> {
    const dto = toReport(report);
    await bestEffort(`realtime ${type}`, () =>
      this.realtime.messageEvent(report.conversationId, type, { report: dto }),
    );
    return dto;
  }

  private async loadKeywords() {
    const now = this.clock();
    if (this.keywordCache && now - this.keywordCache.loadedAt < KEYWORD_CACHE_MS) return this.keywordCache.keywords;
    const keywords = (await this.repository.activeKeywords()).map((row) => ({
      id: row.id,
      text: row.keyword.toLowerCase(),
    }));
    this.keywordCache = { loadedAt: now, keywords };
    return keywords;
  }

  /** Customer names from Backend 1, best effort: a list never fails because the directory is down. */
  private async names(ids: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    await Promise.all(
      [...new Set(ids)].map(async (id) => {
        try {
          const profile = await this.directory.getCustomer(id);
          if (profile) found.set(id, profile.name);
        } catch {
          /* the name is optional */
        }
      }),
    );
    return found;
  }

  private presentBlock(row: CustomerBlock, auth: AuthContext, names: Map<string, string>): BlockDto {
    return {
      id: idToString(row.id),
      customerId: idToString(row.customerId),
      customerName: names.get(row.customerId) ?? null,
      blockedBy: idToString(row.blockedBy),
      reason: row.reason,
      blockedAt: row.blockedAt.toISOString(),
      unblockedAt: row.unblockedAt === null ? null : row.unblockedAt.toISOString(),
      unblockedBy: row.unblockedBy === null ? null : idToString(row.unblockedBy),
      permissions: { canUnblock: row.unblockedAt === null && (isSupervisor(auth) || row.blockedBy === auth.userId) },
    };
  }
}

const toKeyword = (row: BlockedKeyword): KeywordDto => ({
  id: idToString(row.id),
  keyword: row.keyword,
  isActive: row.isActive,
  createdBy: row.createdBy === null ? null : idToString(row.createdBy),
  createdAt: row.createdAt.toISOString(),
});

const toReport = (row: SpamReport): SpamReportDto => ({
  id: idToString(row.id),
  conversationId: idToString(row.conversationId),
  reportedBy: { type: row.reportedByType as "AGENT" | "CUSTOMER", id: idToString(row.reportedById) },
  messageId: row.messageId === null ? null : idToString(row.messageId),
  reason: row.reason,
  status: row.status as SpamStatus,
  reviewedBy: row.reviewedBy === null ? null : idToString(row.reviewedBy),
  reviewedAt: row.reviewedAt === null ? null : row.reviewedAt.toISOString(),
  resolutionNote: row.resolutionNote,
  createdAt: row.createdAt.toISOString(),
});

const toActivity = (row: ModerationActivity): ModerationActivityDto => ({
  id: idToString(row.id),
  actorId: idToString(row.actorId),
  action: row.action,
  targetType: row.targetType as ModerationTarget,
  targetId: idToString(row.targetId),
  metadata: row.metadata,
  createdAt: row.createdAt.toISOString(),
});
