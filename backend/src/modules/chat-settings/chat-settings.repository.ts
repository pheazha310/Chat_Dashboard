import { prisma, type Db } from "@config/database.js";
import type { ChatSettingsDto, ChatSettingsPatch } from "./chat-settings.types.js";

const select = {
  typingSoundEnabled: true,
  notificationSoundEnabled: true,
  aiSuggestionsEnabled: true,
  aiSummariesEnabled: true,
  autoAssignEnabled: true,
} as const;

export class ChatSettingsRepository {
  constructor(private readonly db: Db = prisma) {}

  find(userId: string): Promise<ChatSettingsDto | null> {
    return this.db.userChatSetting.findUnique({ where: { userId }, select });
  }

  /**
   * Creates the row on first save, otherwise changes only the given columns. A single `INSERT … ON CONFLICT`, so two
   * windows saving at once cannot fail on the unique key and cannot undo each other's different switches.
   */
  upsert(userId: string, patch: ChatSettingsPatch): Promise<ChatSettingsDto> {
    return this.db.userChatSetting.upsert({ where: { userId }, create: { userId, ...patch }, update: patch, select });
  }
}
