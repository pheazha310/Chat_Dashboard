import { prisma, type Db } from "@config/database.js";
import type { PreferencesInput } from "./notification.schema.js";

const mine = (agentId: string) => ({ recipientType: "AGENT", recipientId: agentId });

export class NotificationRepository {
  constructor(private readonly db: Db = prisma) {}

  findPreferences(agentId: string) {
    return this.db.notificationPreference.findUnique({ where: { agentId } });
  }

  /** Creates the row on first change; unspecified switches keep their defaults (all on). */
  upsertPreferences(agentId: string, input: PreferencesInput) {
    const data = {
      ...(input.newMessage === undefined ? {} : { newMessageEnabled: input.newMessage }),
      ...(input.assignment === undefined ? {} : { assignmentEnabled: input.assignment }),
      ...(input.transfer === undefined ? {} : { transferEnabled: input.transfer }),
      ...(input.mention === undefined ? {} : { mentionEnabled: input.mention }),
      ...(input.sound === undefined ? {} : { soundEnabled: input.sound }),
      ...(input.browser === undefined ? {} : { browserEnabled: input.browser }),
    };
    return this.db.notificationPreference.upsert({ where: { agentId }, create: { agentId, ...data }, update: data });
  }

  async isMuted(conversationId: string, agentId: string): Promise<boolean> {
    const setting = await this.db.conversationNotificationSetting.findUnique({
      where: { conversationId_agentId: { conversationId, agentId } },
      select: { isMuted: true },
    });
    return setting?.isMuted ?? false;
  }

  setMuted(conversationId: string, agentId: string, isMuted: boolean) {
    return this.db.conversationNotificationSetting.upsert({
      where: { conversationId_agentId: { conversationId, agentId } },
      create: { conversationId, agentId, isMuted },
      update: { isMuted },
    });
  }

  create(data: {
    agentId: string;
    type: string;
    title: string;
    body?: string;
    conversationId?: string;
    messageId?: string;
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

  async list(agentId: string, unreadOnly: boolean, page: { skip: number; take: number }) {
    const where = { ...mine(agentId), ...(unreadOnly ? { readAt: null } : {}) };
    const [items, total] = await Promise.all([
      this.db.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...page }),
      this.db.notification.count({ where }),
    ]);
    return { items, total };
  }

  countUnread(agentId: string) {
    return this.db.notification.count({ where: { ...mine(agentId), readAt: null } });
  }

  /** Scoped to the recipient, so one agent can never read-mark or even see another's notification. */
  findOwned(id: string, agentId: string) {
    return this.db.notification.findFirst({ where: { id, ...mine(agentId) } });
  }

  async markRead(id: string, agentId: string): Promise<void> {
    await this.db.notification.updateMany({
      where: { id, ...mine(agentId), readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(agentId: string): Promise<number> {
    const { count } = await this.db.notification.updateMany({
      where: { ...mine(agentId), readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }
}
