import { prisma, type Db } from "@config/database.js";

export type AutoReplyTrigger = "FIRST_RESPONSE" | "AWAY";

export interface AutoReplyRule {
  id: string;
  responseContent: string;
}

/** The two automatic replies the team keeps, stored as `automation_rules` (one per trigger) with a log of each send. */
export class AutoResponseRepository {
  constructor(private readonly db: Db = prisma) {}

  /** The active rule for a trigger, or null when the team has not saved a text (nothing is sent then). */
  findActiveRule(trigger: AutoReplyTrigger): Promise<AutoReplyRule | null> {
    return this.db.automationRule.findFirst({
      where: { triggerType: trigger, isActive: true },
      select: { id: true, responseContent: true },
    });
  }

  /** Whether the rule was already sent to the conversation, ever (`since` null) or after `since`. */
  async wasSentSince(ruleId: string, conversationId: string, since: Date | null): Promise<boolean> {
    const count = await this.db.automationLog.count({
      where: { ruleId, conversationId, executionStatus: "SUCCESS", ...(since ? { createdAt: { gte: since } } : {}) },
    });
    return count > 0;
  }

  async log(entry: {
    ruleId: string;
    conversationId: string;
    messageId?: string;
    executionStatus: "SUCCESS" | "FAILED";
    errorMessage?: string;
  }): Promise<void> {
    await this.db.automationLog.create({ data: entry });
  }
}
