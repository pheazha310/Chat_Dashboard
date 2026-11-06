import { escalateRequest } from "@/shared/api/rest";
import { notify } from "@/shared/ui";

/** Asks a supervisor to look at the conversation. Only the owner of an open conversation can; the server decides. */
export async function escalateConversation(conversationId: string, reason?: string) {
  try {
    await escalateRequest(conversationId, reason?.trim() || undefined);
    notify("Conversation escalated to a supervisor");
    return true;
  } catch (error) {
    notify(error instanceof Error ? error.message : "Could not escalate the conversation");
    return false;
  }
}
