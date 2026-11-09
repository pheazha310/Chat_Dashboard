import type { BackendConversation, BackendTag, BackendTagRef } from "@/shared/api/backend/types";
import { apiRequest } from "./client";

/** Tags and priority (docs/api-tags-priority.md). */
export const listTags = async () => (await apiRequest<BackendTag[]>("/tags", { query: { size: 200 } })).data;

export const createTagRequest = async (name: string) =>
  (await apiRequest<BackendTag>("/tags", { method: "POST", body: { name } })).data;

export const setConversationTagsRequest = async (conversationId: string, tagIds: string[]) =>
  (
    await apiRequest<{ tags: BackendTagRef[] }>(`/conversations/${conversationId}/tags`, {
      method: "PUT",
      body: { tagIds },
    })
  ).data;

export const setPriorityRequest = async (conversationId: string, priority: "HIGH" | "MEDIUM" | "LOW") =>
  (
    await apiRequest<BackendConversation>(`/conversations/${conversationId}/priority`, {
      method: "PATCH",
      body: { priority },
    })
  ).data;
