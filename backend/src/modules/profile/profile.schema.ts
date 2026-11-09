import { listQuery } from "@modules/conversations/conversation.schema.js";

/** The inbox query without `filter`: "my conversations" always means the ones the agent owns. */
export const agentConversationsQuery = listQuery.omit({ filter: true });
