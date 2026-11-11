import { prisma, runInTransaction, type Db } from "@config/database.js";
import type { AutoResponsesDto } from "./automation.types.js";
import type { AutoReplyTrigger } from "./auto-response.repository.js";

const RULE_NAMES: Record<AutoReplyTrigger, string> = { FIRST_RESPONSE: "First response", AWAY: "Away message" };

const exampleSelect = {
  id: true,
  customerMessage: true,
  suggestedReply: true,
  status: true,
  createdBy: true,
  approvedBy: true,
  approvedAt: true,
  createdAt: true,
} as const;

export class AutomationRepository {
  constructor(private readonly db: Db = prisma) {}

  async findAutoResponses(): Promise<AutoResponsesDto> {
    const rules = await this.db.automationRule.findMany({
      where: { triggerType: { in: ["FIRST_RESPONSE", "AWAY"] }, isActive: true },
      select: { triggerType: true, responseContent: true },
    });
    const byTrigger = new Map(rules.map((rule) => [rule.triggerType, rule.responseContent]));
    return { awayMessage: byTrigger.get("AWAY") ?? null, firstResponse: byTrigger.get("FIRST_RESPONSE") ?? null };
  }

  /** Saves both texts together (all or nothing), creating the rules on first save and switching them on. */
  saveAutoResponses(userId: string, texts: { awayMessage: string; firstResponse: string }): Promise<void> {
    return runInTransaction(this.db, async (tx) => {
      const values: [AutoReplyTrigger, string][] = [
        ["FIRST_RESPONSE", texts.firstResponse],
        ["AWAY", texts.awayMessage],
      ];
      for (const [triggerType, responseContent] of values) {
        const existing = await tx.automationRule.findFirst({ where: { triggerType }, select: { id: true } });
        if (existing) {
          await tx.automationRule.update({ where: { id: existing.id }, data: { responseContent, isActive: true } });
        } else {
          await tx.automationRule.create({
            data: { name: RULE_NAMES[triggerType], triggerType, responseContent, createdBy: userId },
          });
        }
      }
    });
  }

  listExamples() {
    return this.db.aiTrainingExample.findMany({ orderBy: { createdAt: "desc" }, select: exampleSelect });
  }

  createExample(createdBy: string, input: { customerMessage: string; suggestedReply: string }) {
    return this.db.aiTrainingExample.create({ data: { ...input, createdBy }, select: exampleSelect });
  }

  /** Approves (with who and when) or takes the approval back. Null when the example does not exist. */
  async setApproval(id: string, approval: { by: string; at: Date } | null) {
    const result = await this.db.aiTrainingExample.updateMany({
      where: { id },
      data: approval
        ? { status: "APPROVED", approvedBy: approval.by, approvedAt: approval.at }
        : { status: "PENDING", approvedBy: null, approvedAt: null },
    });
    if (result.count === 0) return null;
    return this.db.aiTrainingExample.findUnique({ where: { id }, select: exampleSelect });
  }
}
