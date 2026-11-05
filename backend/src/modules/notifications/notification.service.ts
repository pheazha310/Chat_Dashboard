import { NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import type { ConversationAccess } from "@shared/ports/conversation-access.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import { pageArgs, pageMeta } from "@shared/utils/pagination.js";
import type { Notification, NotificationPreference } from "../../../prisma/generated/prisma/client.js";
import type { NotificationRepository } from "./notification.repository.js";
import type { ListQuery, PreferencesInput } from "./notification.schema.js";
import type {
  NotificationDto,
  NotificationPreferencesDto,
  NotificationType,
  NotifyAgentInput,
} from "./notification.types.js";

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
  /**
   * `access` is a function because the conversation service (which needs this service) is built after it.
   */
  constructor(
    private readonly repository: NotificationRepository,
    private readonly realtime: RealtimeNotifier,
    private readonly access: () => ConversationAccess,
  ) {}

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
    const stored = await this.repository.create(input);
    await bestEffort("realtime", () => this.realtime.notification(input.agentId, toNotification(stored)));
    return true;
  }

  async list(auth: AuthContext, query: ListQuery) {
    const { items, total } = await this.repository.list(auth.userId, query.unread, pageArgs(query));
    return {
      items: items.map(toNotification),
      meta: { ...pageMeta(total, query), unreadCount: await this.repository.countUnread(auth.userId) },
    };
  }

  async unreadCount(auth: AuthContext) {
    return { unreadCount: await this.repository.countUnread(auth.userId) };
  }

  /** Marks one of the caller's own notifications read (idempotent). Other people's look like missing ones. */
  async markRead(auth: AuthContext, notificationId: bigint): Promise<NotificationDto> {
    if (!(await this.repository.findOwned(notificationId, auth.userId))) {
      throw new NotFoundError(`Notification ${idToString(notificationId)} not found`);
    }
    await this.repository.markRead(notificationId, auth.userId);
    const updated = await this.repository.findOwned(notificationId, auth.userId);
    await this.announceRead(auth.userId, idToString(notificationId));
    return toNotification(updated as Notification);
  }

  async markAllRead(auth: AuthContext) {
    const updated = await this.repository.markAllRead(auth.userId);
    await this.announceRead(auth.userId, null);
    return { updated, unreadCount: 0 };
  }

  /** Mute or unmute new-message notifications for one conversation the caller can see. */
  async setMuted(auth: AuthContext, conversationId: bigint, muted: boolean) {
    await this.access().requireVisible(auth, conversationId);
    await this.repository.setMuted(conversationId, auth.userId, muted);
    return { conversationId: idToString(conversationId), muted };
  }

  async getPreferences(auth: AuthContext): Promise<NotificationPreferencesDto> {
    return toPreferences(await this.repository.findPreferences(auth.userId));
  }

  async updatePreferences(auth: AuthContext, input: PreferencesInput): Promise<NotificationPreferencesDto> {
    return toPreferences(await this.repository.upsertPreferences(auth.userId, input));
  }

  /** Tells the agent's other sessions, with the new count so badges stay right everywhere. */
  private async announceRead(agentId: bigint, notificationId: string | null) {
    await bestEffort("realtime", async () => {
      await this.realtime.notificationRead(agentId, {
        notificationId,
        unreadCount: await this.repository.countUnread(agentId),
      });
    });
  }
}

const toNotification = (row: Notification): NotificationDto => ({
  id: idToString(row.id),
  type: row.notificationType,
  title: row.title,
  body: row.body,
  conversationId: row.conversationId === null ? null : idToString(row.conversationId),
  messageId: row.messageId === null ? null : idToString(row.messageId),
  read: row.readAt !== null,
  createdAt: row.createdAt.toISOString(),
});

/** No row yet means every switch is on (the schema defaults). */
const toPreferences = (row: NotificationPreference | null): NotificationPreferencesDto => ({
  newMessage: row?.newMessageEnabled ?? true,
  assignment: row?.assignmentEnabled ?? true,
  transfer: row?.transferEnabled ?? true,
  mention: row?.mentionEnabled ?? true,
  sound: row?.soundEnabled ?? true,
  browser: row?.browserEnabled ?? true,
});
