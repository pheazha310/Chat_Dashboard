import type { Conversation } from "./store";

/**
 * Whether the signed-in agent may write in a conversation, as the backend decides it: only the agent who handles
 * (owns) the conversation can send text, files or voice (docs/chat-logic-design.md). Everyone else first takes it
 * over. `me` is the signed-in agent's id, or null when unknown.
 */
export const canReply = (conversation: Pick<Conversation, "handoff" | "assignedAgent">, me: string | null) =>
  conversation.handoff === "assigned" && !!me && conversation.assignedAgent?.id === me;
