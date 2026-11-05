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

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  conversationId: string | null;
  messageId: string | null;
  read: boolean;
  createdAt: string;
}

/** Which notifications an agent wants, and how. `sound` and `browser` are hints for the client. */
export interface NotificationPreferencesDto {
  newMessage: boolean;
  assignment: boolean;
  transfer: boolean;
  mention: boolean;
  sound: boolean;
  browser: boolean;
}
