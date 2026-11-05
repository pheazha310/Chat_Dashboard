import type { ConversationEventDto } from "@modules/conversations/index.js";

/** What the realtime layer needs to know about a conversation: its public state and who may see it. */
export interface ConversationSnapshot {
  conversation: ConversationEventDto;
  audience: { handoffStatus: string; assignedAgentId: string | null; viewerIds: string[] };
}

export interface ConversationSnapshots {
  snapshot(conversationId: string): Promise<ConversationSnapshot | null>;
}
