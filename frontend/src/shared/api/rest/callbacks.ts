import { apiRequest } from "./client";

export type Callback = {
  id: string;
  conversationId: string;
  customerId: string;
  assignedAgentId: string | null;
  createdBy: string | null;
  scheduledAt: string;
  status: "PENDING" | "COMPLETED" | "CANCELLED" | "MISSED";
  notes: string | null;
  completionNote: string | null;
  createdAt: string;
  completedAt: string | null;
  permissions: { canEdit: boolean; canComplete: boolean; canCancel: boolean };
};

/** Callbacks (docs/api-callbacks.md). `scheduledAt` must be an ISO time with an offset. */
export const listCallbacks = async (conversationId: string) =>
  (await apiRequest<Callback[]>(`/conversations/${conversationId}/callbacks`)).data;

export const scheduleCallbackRequest = async (conversationId: string, scheduledAt: string, notes?: string) =>
  (
    await apiRequest<Callback>(`/conversations/${conversationId}/callbacks`, {
      method: "POST",
      body: { scheduledAt, ...(notes ? { notes } : {}) },
    })
  ).data;

export const completeCallbackRequest = async (callbackId: string, completionNote?: string) =>
  (
    await apiRequest<Callback>(`/callbacks/${callbackId}/complete`, {
      method: "POST",
      body: completionNote ? { completionNote } : {},
    })
  ).data;

export const cancelCallbackRequest = async (callbackId: string) =>
  (await apiRequest<Callback>(`/callbacks/${callbackId}/cancel`, { method: "POST" })).data;
