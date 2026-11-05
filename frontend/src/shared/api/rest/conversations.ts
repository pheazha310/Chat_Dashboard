import type { BackendActivity, BackendConversation, BackendMessage } from "@/shared/api/backend/types";
import { apiRequest } from "./client";

export type MessagePageMeta = {
  limit: number;
  hasMore: boolean;
  direction: "older" | "newer";
  oldestSequence: string | null;
  newestSequence: string | null;
};

/** Newest page by default; `before` pages back, `after` returns what was missed since a sequence number. */
export async function getMessages(
  conversationId: string,
  params: { before?: string; after?: string; limit?: number } = {},
  signal?: AbortSignal,
) {
  const { data, meta } = await apiRequest<BackendMessage[], MessagePageMeta>(
    `/conversations/${conversationId}/messages`,
    {
      query: params,
      ...(signal ? { signal } : {}),
    },
  );
  return { items: data, meta };
}

export async function getConversation(conversationId: string) {
  return (await apiRequest<BackendConversation>(`/conversations/${conversationId}`)).data;
}

export async function getActivities(conversationId: string) {
  return (await apiRequest<BackendActivity[]>(`/conversations/${conversationId}/activities`, { query: { size: 20 } }))
    .data;
}

export async function listConversations(params: { filter?: string; q?: string; page?: number; size?: number } = {}) {
  return (await apiRequest<BackendConversation[]>("/conversations", { query: params })).data;
}

export const archiveConversationRequest = (conversationId: string) =>
  apiRequest<BackendConversation>(`/conversations/${conversationId}/archive`, { method: "POST" });

export const restoreConversationRequest = (conversationId: string) =>
  apiRequest<BackendConversation>(`/conversations/${conversationId}/restore`, { method: "POST" });
