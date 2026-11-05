import { useConversationStore } from "@/entities/conversation";
import { ApiError, archiveConversationRequest, restoreConversationRequest } from "@/shared/api/rest";
import { isMockTransport } from "@/shared/api/ws";
import { notify } from "@/shared/ui";

const reason = (error: unknown) => (error instanceof ApiError ? error.message : "Something went wrong");

/** Archives right away so the list reacts instantly; with the real backend it is undone if the server refuses. */
export async function archiveConversation(conversationId: string): Promise<boolean> {
  useConversationStore.getState().archiveLocally(conversationId);
  if (isMockTransport) return true;
  try {
    await archiveConversationRequest(conversationId);
    return true;
  } catch (error) {
    useConversationStore.getState().unarchiveLocally(conversationId);
    notify(`Could not archive: ${reason(error)}`);
    return false;
  }
}

export async function restoreConversation(conversationId: string): Promise<boolean> {
  useConversationStore.getState().unarchiveLocally(conversationId);
  if (isMockTransport) return true;
  try {
    await restoreConversationRequest(conversationId);
    return true;
  } catch (error) {
    useConversationStore.getState().archiveLocally(conversationId);
    notify(`Could not restore: ${reason(error)}`);
    return false;
  }
}
