import { blockConversationCustomer, reportSpamRequest } from "@/shared/api/rest";
import { notify } from "@/shared/ui";

const failure = (error: unknown, fallback: string) => notify(error instanceof Error ? error.message : fallback);

/**
 * Blocks the conversation's customer. Only the conversation's owner or a supervisor can; the server decides.
 * Open conversations stay open, and agents can still write to them.
 */
export async function blockConversationCustomerAction(conversationId: string, reason?: string) {
  try {
    await blockConversationCustomer(conversationId, reason?.trim() || undefined);
    notify("Customer blocked");
    return true;
  } catch (error) {
    failure(error, "Could not block the customer");
    return false;
  }
}

/** Reports the conversation (or one message) to the supervisors as spam or abuse. */
export async function reportSpamAction(conversationId: string, reason: string, messageId?: string) {
  if (!reason.trim()) return false;
  try {
    await reportSpamRequest(conversationId, reason.trim(), messageId);
    notify("Reported to the supervisors");
    return true;
  } catch (error) {
    failure(error, "Could not send the report");
    return false;
  }
}
