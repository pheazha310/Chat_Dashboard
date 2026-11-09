import type { BackendNote } from "@/shared/api/backend/types";
import { apiRequest } from "./client";

/** Internal notes (docs/api-notes-escalations.md). */
export const listNotes = async (conversationId: string) =>
  (await apiRequest<BackendNote[]>(`/conversations/${conversationId}/notes`, { query: { size: 100 } })).data;

export const createNoteRequest = async (conversationId: string, text: string, mentionedAgentIds: string[]) =>
  (
    await apiRequest<BackendNote>(`/conversations/${conversationId}/notes`, {
      method: "POST",
      body: { text, mentionedAgentIds },
    })
  ).data;

export const updateNoteRequest = async (noteId: string, patch: { text?: string; mentionedAgentIds?: string[] }) =>
  (await apiRequest<BackendNote>(`/notes/${noteId}`, { method: "PATCH", body: patch })).data;

export const deleteNoteRequest = (noteId: string) => apiRequest<unknown>(`/notes/${noteId}`, { method: "DELETE" });

export type Escalation = {
  id: string;
  conversationId: string;
  requestedBy: string;
  reason: string | null;
  status: "PENDING" | "RESOLVED" | "CANCELLED";
  createdAt: string;
};

export const escalateRequest = async (conversationId: string, reason?: string) =>
  (
    await apiRequest<Escalation>(`/conversations/${conversationId}/escalations`, {
      method: "POST",
      body: reason ? { reason } : {},
    })
  ).data;
