import { apiRequest } from "./client";

/** The agent's own switches (docs/api-chat-settings.md). */
export type ChatSettings = {
  typingSoundEnabled: boolean;
  notificationSoundEnabled: boolean;
  aiSuggestionsEnabled: boolean;
  aiSummariesEnabled: boolean;
  autoAssignEnabled: boolean;
};

export const getChatSettings = async () => (await apiRequest<ChatSettings>("/agents/me/chat-settings")).data;

export const updateChatSettings = async (patch: Partial<ChatSettings>) =>
  (await apiRequest<ChatSettings>("/agents/me/chat-settings", { method: "PATCH", body: patch })).data;
