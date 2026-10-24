import { useConversationStore } from "@/entities/conversation";
import { useMessageStore } from "@/entities/message";
import { wsClient } from "@/shared/api/ws";
import { notify } from "@/shared/ui";

/** Routes server events into the entity stores. Returns a teardown function. */
export function startRealtime() {
  const conversations = useConversationStore;
  const messages = useMessageStore;

  const offs = [
    wsClient.onStatus((status) => status === "open" && wsClient.send("sync.request", {})),
    wsClient.on("sync", (payload) => {
      conversations.getState().setAll(payload.conversations);
      messages.getState().replaceAll(payload.messages);
    }),
    wsClient.on("message.new", ({ message }) => messages.getState().upsert(message)),
    wsClient.on("message.ack", ({ message }) => messages.getState().upsert(message)),
    wsClient.on("message.status", ({ conversationId, messageId, status }) =>
      messages.getState().setStatus(conversationId, messageId, status),
    ),
    wsClient.on("typing", ({ conversationId, side, active }) =>
      messages.getState().setTyping(conversationId, side, active),
    ),
    wsClient.on("conversation.updated", ({ conversation }) => {
      const store = conversations.getState();
      const viewing = store.selectedId === conversation.id && conversation.unread > 0;
      store.upsert(viewing ? { ...conversation, unread: 0 } : conversation);
      if (viewing) wsClient.send("conversation.read", { conversationId: conversation.id });
    }),
    wsClient.on("conversation.assigned", ({ conversationId, agent }) => {
      const store = conversations.getState();
      const conversation = store.byId[conversationId];
      if (!conversation) return;
      store.upsert({ ...conversation, handoff: "assigned", assignedAgent: agent });
      notify(`Conversation assigned to ${agent.name}`);
    }),
    wsClient.on("notice", ({ text }) => notify(text)),
  ];

  wsClient.connect();
  return () => {
    offs.forEach((off) => off());
    wsClient.disconnect();
  };
}
