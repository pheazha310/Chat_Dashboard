import type { BackendMessage, BackendReaction } from "@/shared/api/backend/types";
import { apiRequest } from "./client";

export type EditHistory = {
  messageId: string;
  conversationId: string;
  currentContent: string | null;
  edits: { id: string; editorType: string; editorId: string; previousContent: string; editedAt: string }[];
};

/** Message actions (docs/api-message-actions.md). Messages are addressed by id alone. */
export const editMessageRequest = async (messageId: string, text: string) =>
  (await apiRequest<BackendMessage>(`/messages/${messageId}`, { method: "PATCH", body: { text } })).data;

export const deleteMessageRequest = (messageId: string) =>
  apiRequest<unknown>(`/messages/${messageId}`, { method: "DELETE" });

export const getEditHistory = async (messageId: string) =>
  (await apiRequest<EditHistory>(`/messages/${messageId}/history`)).data;

export const reactRequest = async (messageId: string, emoji: string) =>
  (
    await apiRequest<{ reactions: BackendReaction[] }>(`/messages/${messageId}/reactions`, {
      method: "PUT",
      body: { emoji },
    })
  ).data;

export const unreactRequest = async (messageId: string, reactionId: string) =>
  (
    await apiRequest<{ reactions: BackendReaction[] }>(`/messages/${messageId}/reactions/${reactionId}`, {
      method: "DELETE",
    })
  ).data;

export const forwardRequest = async (messageId: string, targetConversationId: string, clientId: string) =>
  (
    await apiRequest<BackendMessage>(`/messages/${messageId}/forwards`, {
      method: "POST",
      body: { targetConversationId, clientId },
    })
  ).data;
