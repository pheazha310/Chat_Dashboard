/** One agent's chat switches (table `user_chat_settings`). Defaults apply while the agent has saved nothing. */
export interface ChatSettingsDto {
  typingSoundEnabled: boolean;
  notificationSoundEnabled: boolean;
  /** Stored for the future AI assistant. No AI exists yet, so nothing reads it. */
  aiSuggestionsEnabled: boolean;
  /** Stored for the future AI assistant. No AI exists yet, so nothing reads it. */
  aiSummariesEnabled: boolean;
  /** The agent's opt-in to automatic assignment. Nothing assigns automatically yet, so nothing reads it. */
  autoAssignEnabled: boolean;
}

export type ChatSettingsPatch = Partial<ChatSettingsDto>;

export const DEFAULT_CHAT_SETTINGS: ChatSettingsDto = {
  typingSoundEnabled: true,
  notificationSoundEnabled: true,
  aiSuggestionsEnabled: true,
  aiSummariesEnabled: true,
  autoAssignEnabled: false,
};
