import type { NotificationRepository } from "./notification.repository.js";
import type { NotifyAgentInput, NotificationType } from "./notification.types.js";

type Preferences = {
  newMessageEnabled: boolean;
  assignmentEnabled: boolean;
  transferEnabled: boolean;
  mentionEnabled: boolean;
};

/** Which preference switch (if any) controls each notification type. Types not listed are always delivered. */
const switches: Partial<Record<NotificationType, keyof Preferences>> = {
  NEW_MESSAGE: "newMessageEnabled",
  ASSIGNED: "assignmentEnabled",
  TRANSFERRED: "transferEnabled",
  MENTION: "mentionEnabled",
};

export class NotificationService {
  constructor(private readonly repository: NotificationRepository) {}

  /** Stores a notification unless the agent switched that type off (or muted the conversation for new messages). */
  async notifyAgent(input: NotifyAgentInput): Promise<boolean> {
    const key = switches[input.type];
    if (key) {
      const preferences = await this.repository.findPreferences(input.agentId);
      if (preferences && !preferences[key]) return false;
    }
    if (input.type === "NEW_MESSAGE" && input.conversationId !== undefined) {
      if (await this.repository.isMuted(input.conversationId, input.agentId)) return false;
    }
    await this.repository.create(input);
    return true;
  }
}
