import { useConversationStore } from "@/entities/conversation";
import { wsClient } from "@/shared/api/ws";

/** Select a conversation and tell the server its unread messages were seen. */
export function selectConversation(id: string) {
  const store = useConversationStore.getState();
  store.select(id);
  if (store.byId[id]?.unread) {
    store.markReadLocally(id);
    wsClient.send("conversation.read", { conversationId: id });
  }
}
