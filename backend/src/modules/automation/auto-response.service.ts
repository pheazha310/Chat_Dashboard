import type { AutoResponder, AutomaticMessagePort } from "@shared/ports/auto-response.js";
import type { AvailableAgents } from "@shared/ports/available-agents.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import type { AutoReplyTrigger, AutoResponseRepository } from "./auto-response.repository.js";

/** The away message is repeated to the same conversation at most this often. */
const AWAY_REPEAT_MS = 60 * 60 * 1000;

/**
 * Sends the team's saved automatic replies. The first response goes out once, when a customer opens a conversation.
 * The away message goes out when a customer writes and no agent is available, at most once an hour per conversation.
 * Nothing is sent until the team has saved a text. A failure is logged and never reaches the customer's own request.
 */
export class AutoResponseService implements AutoResponder {
  constructor(
    private readonly repository: AutoResponseRepository,
    private readonly messages: () => AutomaticMessagePort,
    private readonly availableAgents: AvailableAgents,
    private readonly clock: () => number = Date.now,
  ) {}

  async conversationStarted(conversationId: string): Promise<void> {
    await bestEffort("first response", () => this.send("FIRST_RESPONSE", conversationId, null));
  }

  async customerMessaged(conversationId: string): Promise<void> {
    await bestEffort("away message", async () => {
      if ((await this.availableAgents.availableAgentIds()).length > 0) return;
      await this.send("AWAY", conversationId, new Date(this.clock() - AWAY_REPEAT_MS));
    });
  }

  private async send(trigger: AutoReplyTrigger, conversationId: string, since: Date | null) {
    const rule = await this.repository.findActiveRule(trigger);
    if (!rule) return;
    if (await this.repository.wasSentSince(rule.id, conversationId, since)) return;
    let messageId: string | null;
    try {
      messageId = await this.messages().postAutomatic(conversationId, rule.responseContent, {
        automatic: true,
        trigger,
      });
    } catch (error) {
      await this.repository.log({
        ruleId: rule.id,
        conversationId,
        executionStatus: "FAILED",
        errorMessage: error instanceof Error ? error.message : "unknown error",
      });
      return;
    }
    // Outside the try: a log failure must not be recorded as a failed send of a message that was delivered.
    if (messageId)
      await this.repository.log({ ruleId: rule.id, conversationId, messageId, executionStatus: "SUCCESS" });
  }
}
