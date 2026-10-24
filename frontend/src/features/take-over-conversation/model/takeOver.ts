import { wsClient } from "@/shared/api/ws";

export const takeOverConversation = (conversationId: string) =>
  wsClient.send("conversation.takeover", { conversationId });
