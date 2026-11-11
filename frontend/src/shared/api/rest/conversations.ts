import type { BackendActivity, BackendConversation, BackendMessage } from "@/shared/api/backend/types";
import { apiRequest } from "./client";

export type MessagePageMeta = {
  limit: number;
  hasMore: boolean;
  direction: "older" | "newer";
  oldestSequence: string | null;
  newestSequence: string | null;
};

/**
 * Newest page by default; `before` pages back, `after` returns what was missed since a sequence number, `from` (ISO
 * time) starts at the first message on or after it.
 */
export async function getMessages(
  conversationId: string,
  params: { before?: string; after?: string; from?: string; limit?: number } = {},
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

/** Messages whose text contains `q` (any case), newest first. */
export async function searchMessages(conversationId: string, q: string) {
  const { data, meta } = await apiRequest<BackendMessage[], { limit: number; hasMore: boolean }>(
    `/conversations/${conversationId}/messages/search`,
    { query: { q, limit: 100 } },
  );
  return { items: data, hasMore: meta.hasMore };
}

export type MessageSearchHit = {
  message: BackendMessage;
  conversation: { id: string; customerName: string | null; customerIdentifier: string | null };
};

/** Messages in every conversation the agent may open: whole words and word starts, newest first. */
export async function searchAllMessages(q: string) {
  const { data, meta } = await apiRequest<MessageSearchHit[], { limit: number; hasMore: boolean }>("/messages/search", {
    query: { q, limit: 20 },
  });
  return { items: data, hasMore: meta.hasMore };
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

/** One inbox page with its pagination `meta` (`totalPages`). */
export async function listConversationsPage(params: { filter?: string; page: number; size: number }) {
  return apiRequest<BackendConversation[], { page: number; totalPages: number }>("/conversations", { query: params });
}
