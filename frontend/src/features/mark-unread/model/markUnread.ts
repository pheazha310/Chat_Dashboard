import { useConversationStore } from "@/entities/conversation";
import { wsClient } from "@/shared/api/ws";

/** Flags the conversation unread for this agent: shown at once, stored by the server so other sessions see it too. */
export function markConversationUnread(conversationId: string) {
  useConversationStore.getState().markUnreadLocally(conversationId);
  wsClient.send("conversation.unread", { conversationId });
}
