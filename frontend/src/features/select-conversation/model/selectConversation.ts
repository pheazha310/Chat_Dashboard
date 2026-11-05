import { loadDetails, useConversationStore } from "@/entities/conversation";
import { loadHistory } from "@/entities/message";
import { wsClient } from "@/shared/api/ws";

/** Select a conversation, tell the server its unread messages were seen, and load what the inbox does not carry. */
export function selectConversation(id: string) {
  const store = useConversationStore.getState();
  store.select(id);
  if (store.byId[id]?.unread) {
    store.markReadLocally(id);
    wsClient.send("conversation.read", { conversationId: id });
  }
  void loadHistory(id);
  void loadDetails(id);
}
