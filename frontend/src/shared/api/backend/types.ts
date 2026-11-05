/** What the chat backend sends (see docs/api-conversations.md and docs/websocket-events.md). Ids are strings. */

export type BackendAgentProfile = { id: string; name: string; avatarUrl: string | null };

export type BackendConversation = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerIdentifier: string | null;
  applicationId: string | null;
  subject: string | null;
  status: "OPEN" | "RESOLVED" | "CLOSED";
  priority: "HIGH" | "MEDIUM" | "LOW";
  conversationMode: "AI" | "HUMAN";
  handoffStatus: "NONE" | "NEEDS_HUMAN" | "ASSIGNED";
  assignedAgentId: string | null;
  assignedAgent: BackendAgentProfile | null;
  isArchived: boolean;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  /** Absent in realtime events (it differs per agent). */
  unreadCount?: number;
  /** Only in the detail response. */
  summary?: string | null;
};

export type BackendMessage = {
  id: string;
  conversationId: string;
  clientId: string | null;
  sequenceNumber: string;
  senderType: "CUSTOMER" | "AGENT" | "ASSISTANT" | "SYSTEM";
  senderId: string | null;
  type: string;
  content: string | null;
  status: "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  createdAt: string;
};

export type BackendActivity = {
  id: string;
  conversationId: string;
  activityType: string;
  description: string | null;
  createdAt: string;
};

export type BackendNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  conversationId: string | null;
  read: boolean;
  createdAt: string;
};

/** The `{ type, payload }` frames of the gateway. */
export type BackendFrame = { type: string; payload: Record<string, unknown> };
