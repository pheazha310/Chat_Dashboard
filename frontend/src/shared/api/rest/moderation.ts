import { apiRequest } from "./client";

export type CustomerBlock = {
  id: string;
  customerId: string;
  customerName: string | null;
  blockedBy: string;
  reason: string | null;
  blockedAt: string;
  unblockedAt: string | null;
  permissions: { canUnblock: boolean };
};
export type BlockedKeyword = { id: string; keyword: string; isActive: boolean; createdAt: string };
export type SpamReport = {
  id: string;
  conversationId: string;
  messageId: string | null;
  reason: string;
  status: "PENDING" | "CONFIRMED" | "DISMISSED";
  createdAt: string;
};

/** Blocking, blocked keywords and spam reports (docs/api-moderation.md). The server decides who may do what. */
export const listBlocks = async () =>
  (await apiRequest<CustomerBlock[]>("/moderation/blocks", { query: { size: 100 } })).data;

export const blockCustomerById = async (customerId: string, reason?: string) =>
  (
    await apiRequest<CustomerBlock>(`/moderation/customers/${customerId}/block`, {
      method: "POST",
      body: reason ? { reason } : {},
    })
  ).data;

export const blockConversationCustomer = async (conversationId: string, reason?: string) =>
  (
    await apiRequest<CustomerBlock>(`/conversations/${conversationId}/customer-block`, {
      method: "POST",
      body: reason ? { reason } : {},
    })
  ).data;

export const unblockCustomer = (customerId: string) =>
  apiRequest<CustomerBlock>(`/moderation/customers/${customerId}/block`, { method: "DELETE" });

export const listKeywords = async () =>
  (await apiRequest<BlockedKeyword[]>("/moderation/keywords", { query: { size: 100 } })).data;

export const createKeywordRequest = async (keyword: string) =>
  (await apiRequest<BlockedKeyword>("/moderation/keywords", { method: "POST", body: { keyword } })).data;

export const deleteKeywordRequest = (keywordId: string) =>
  apiRequest<unknown>(`/moderation/keywords/${keywordId}`, { method: "DELETE" });

export const reportSpamRequest = async (conversationId: string, reason: string, messageId?: string) =>
  (
    await apiRequest<SpamReport>(`/conversations/${conversationId}/spam-reports`, {
      method: "POST",
      body: { reason, ...(messageId ? { messageId } : {}) },
    })
  ).data;
