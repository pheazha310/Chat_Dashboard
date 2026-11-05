export type NotificationType =
  | "NEW_MESSAGE"
  | "NEW_CONVERSATION"
  | "HANDOFF"
  | "ASSIGNED"
  | "TRANSFERRED"
  | "MENTION"
  | "CALLBACK"
  | "CALL"
  | "SYSTEM";

export interface NotifyAgentInput {
  agentId: bigint;
  type: NotificationType;
  title: string;
  body?: string;
  conversationId?: bigint;
  messageId?: bigint;
}
