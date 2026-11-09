export type ConversationEventKind =
  "created" | "updated" | "assigned" | "transferred" | "status_changed" | "priority_changed" | "tags_updated";

/**
 * What services tell the realtime layer after a change is committed. Calls are best effort (a failure is logged and
 * never undoes the change). Payload shapes are the same DTOs the REST API returns.
 */
export interface RealtimeNotifier {
  /** A message was stored. `origin` is the socket that sent it (it gets an ack instead of `message.new`). */
  messageCreated(
    message: { id: string; conversationId: string },
    options?: { origin?: string; conversationUpdated?: boolean },
  ): Promise<void>;
  /** Delivery or read status of customer messages changed. */
  messageStatus(conversationId: string, messageIds: string[], status: "DELIVERED" | "READ"): Promise<void>;
  /** Conversation state changed. `alsoNotify` lists users who lost access (e.g. the previous owner). */
  conversationEvent(
    conversationId: string,
    kind: ConversationEventKind,
    extra?: Record<string, unknown>,
    alsoNotify?: string[],
  ): Promise<void>;
  /** An agent's read position or unread flag changed; delivered to all of that agent's sessions. */
  readState(agentId: string, state: object): Promise<void>;
  /** An agent's effective presence changed (AVAILABLE, BUSY, AWAY or OFFLINE). Sent to every dashboard session. */
  presenceChanged(userId: string, status: string): Promise<void>;
  /** An agent started or stopped typing. `origin` is the socket that sent it. */
  typing(
    conversationId: string,
    userId: string,
    active: boolean,
    origin?: string,
    side?: "agent" | "customer",
  ): Promise<void>;
  /** An agent marked notifications read; delivered to all of that agent's sessions. */
  notificationRead(agentId: string, payload: object): Promise<void>;
  /** A notification was stored for an agent. */
  notification(agentId: string, notification: object): Promise<void>;
  /** Any event addressed to one agent, delivered to all of that agent's sessions (workspace, settings, ...). */
  agentEvent(agentId: string, type: string, payload: object): Promise<void>;
  /**
   * A change to an existing message (edit, delete, reaction, forward), delivered to whoever may see the conversation.
   * `conversationUpdated` also sends `conversation.updated`, for when the inbox preview changed.
   */
  messageEvent(
    conversationId: string,
    type: string,
    payload: object,
    options?: { conversationUpdated?: boolean },
  ): Promise<void>;
}
