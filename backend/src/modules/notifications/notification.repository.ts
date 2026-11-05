import { prisma, type Db } from "@config/database.js";

export class NotificationRepository {
  constructor(private readonly db: Db = prisma) {}

  findPreferences(agentId: bigint) {
    return this.db.notificationPreference.findUnique({ where: { agentId } });
  }

  async isMuted(conversationId: bigint, agentId: bigint): Promise<boolean> {
    const setting = await this.db.conversationNotificationSetting.findUnique({
      where: { conversationId_agentId: { conversationId, agentId } },
      select: { isMuted: true },
    });
    return setting?.isMuted ?? false;
  }

  create(data: {
    agentId: bigint;
    type: string;
    title: string;
    body?: string;
    conversationId?: bigint;
    messageId?: bigint;
  }) {
    return this.db.notification.create({
      data: {
        recipientType: "AGENT",
        recipientId: data.agentId,
        notificationType: data.type,
        title: data.title,
        body: data.body ?? null,
        conversationId: data.conversationId ?? null,
        messageId: data.messageId ?? null,
      },
    });
  }
}
