/** What the chat backend sends (see docs/api-conversations.md and docs/websocket-events.md). Ids are strings. */

export type BackendAgentProfile = { id: string; name: string; avatarUrl: string | null };

export type BackendConversation = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerIdentifier: string | null;
  applicationId: number | null;
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
  tags?: BackendTagRef[];
};

export type BackendTagRef = { id: string; name: string; color: string | null };

export type BackendTag = BackendTagRef & { createdBy: string | null; usageCount: number; createdAt: string };

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
  replyToMessageId?: string | null;
  forwardedFromMessageId?: string | null;
  isEdited?: boolean;
  reactions?: BackendReaction[];
  attachments?: BackendAttachment[];
  createdAt: string;
  /** Set on a deleted message (a placeholder with no content). */
  deletedAt?: string | null;
};

export type BackendAttachment = {
  id: string;
  conversationId: string;
  messageId: string | null;
  kind: "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO";
  fileName: string;
  mimeType: string;
  fileSize: number;
  durationMs: number | null;
  waveform: number[] | null;
  createdAt: string;
  /** Path under the API base URL; needs the bearer token. */
  downloadPath: string;
};

export type BackendNote = {
  id: string;
  conversationId: string;
  authorAgentId: string;
  author: { id: string; name: string; avatarUrl: string | null } | null;
  content: string;
  mentionedAgentIds: string[];
  isEdited: boolean;
  createdAt: string;
};

export type BackendReaction = { id: string; userType: string; userId: string; emoji: string; createdAt: string };

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
