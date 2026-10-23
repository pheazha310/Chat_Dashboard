export type MessageSide = "customer" | "assistant" | "agent";
export type DeliveryStatus = "sending" | "sent" | "delivered" | "read" | "failed";
export type HandoffStatus = "ai" | "needs-human" | "assigned";
export type ActivityTone = "blue" | "cyan" | "red";
export type FileKind = "document" | "image";
export type NotificationType = "new-conversation" | "handoff" | "callback" | "mention" | "system";

/// Application lifecycle status (consolidates ApplicationStatus from
/// ApplicationsTable.tsx and the status string on ConversationDto.application).
export type ApplicationStatus = "New" | "Reviewing" | "Completed" | "Failed" | "Paid Off" | "in progress" | "overdue";

export type ChatMessageDto = {
  id: string;
  conversationId: string;
  side: MessageSide;
  text: string;
  createdAt: string;
  status?: DeliveryStatus;
  senderId?: string;
};

export type ActivityDto = {
  id: string;
  tone: ActivityTone;
  title: string;
  time: string;
  copy: string;
};

export type ApplicationDto = {
  appId: string;
  product: string;
  amount: string;
  tenor: string;
  status: ApplicationStatus;
  reference: string;
  loanRequest?: string;
  completeness?: string;
  registeredAt?: string;
};

export type ConversationDto = {
  id: string;
  customerId?: string;
  name: string;
  avatar: string;
  preview: string;
  lastMessageAt: string;
  unread: number;
  urgent: boolean;
  handoff: HandoffStatus;
  assignedAgent?: AgentDto;
  application: ApplicationDto;
  activity: ActivityDto[];
  summary: string;
  summaryImage?: string;
};

export type AgentDto = {
  id: string;
  name: string;
  avatar: string;
  email?: string;
  active?: boolean;
};

export type CustomerDto = {
  id: string;
  name: string;
  avatar?: string;
  email?: string;
  phone?: string;
  nationalId?: string;
  salary?: string;
  occupation?: string;
  blacklisted?: boolean;
};

export type NotificationDto = {
  id: string;
  agentId: string;
  type: NotificationType;
  text: string;
  read: boolean;
  createdAt: string;
};

export type SharedFileDto = {
  id: string;
  conversationId: string;
  customerId: string;
  name: string;
  kind: FileKind;
  size: string;
  url: string;
  addedAt: string;
};

/** Events the server pushes to the client. */
export type ServerEventMap = {
  sync: {
    conversations: ConversationDto[];
    messages: Record<string, ChatMessageDto[]>;
    agents?: AgentDto[];
    notifications?: NotificationDto[];
  };
  "message.new": { message: ChatMessageDto };
  "message.ack": { message: ChatMessageDto };
  "message.status": {
    conversationId: string;
    messageId: string;
    status: DeliveryStatus;
  };
  "conversation.updated": { conversation: ConversationDto };
  "conversation.assigned": { conversationId: string; agent: AgentDto };
  typing: { conversationId: string; side: MessageSide; active: boolean };
  notice: { text: string };
  notification: { notification: NotificationDto };
};

/** Events the client sends to the server. */
export type ClientEventMap = {
  "sync.request": Record<string, never>;
  "message.send": { conversationId: string; clientId: string; text: string };
  "conversation.read": { conversationId: string };
  "conversation.takeover": { conversationId: string };
  "callback.request": { conversationId: string };
};

export type Envelope<T extends string = string, P = unknown> = { type: T; payload: P };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isAgent = (value: unknown): value is AgentDto =>
  isRecord(value) && isString(value.id) && isString(value.name) && isString(value.avatar);
const isConversation = (value: unknown): value is ConversationDto =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.name) &&
  isString(value.avatar) &&
  isString(value.preview) &&
  isString(value.lastMessageAt) &&
  typeof value.unread === "number" &&
  typeof value.urgent === "boolean" &&
  (value.handoff === "ai" || value.handoff === "needs-human" || value.handoff === "assigned") &&
  isRecord(value.application) &&
  Array.isArray(value.activity) &&
  isString(value.summary) &&
  (value.summaryImage === undefined || isString(value.summaryImage)) &&
  (value.customerId === undefined || isString(value.customerId));
const isMessage = (value: unknown): value is ChatMessageDto =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.conversationId) &&
  (value.side === "customer" || value.side === "assistant" || value.side === "agent") &&
  isString(value.text) &&
  isString(value.createdAt) &&
  (value.status === undefined || ["sending", "sent", "delivered", "read", "failed"].includes(String(value.status))) &&
  (value.senderId === undefined || isString(value.senderId));
const isNotification = (value: unknown): value is NotificationDto =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.agentId) &&
  isString(value.type) &&
  isString(value.text) &&
  typeof value.read === "boolean" &&
  isString(value.createdAt);

/** Runtime validation for untrusted frames received over the network. */
export function isServerEvent(type: string, payload: unknown): payload is ServerEventMap[keyof ServerEventMap] {
  if (!isRecord(payload)) return false;
  switch (type) {
    case "sync":
      return (
        Array.isArray(payload.conversations) &&
        payload.conversations.every(isConversation) &&
        isRecord(payload.messages) &&
        Object.values(payload.messages).every((messages) => Array.isArray(messages) && messages.every(isMessage))
      );
    case "message.new":
    case "message.ack":
      return isMessage(payload.message);
    case "message.status":
      return (
        isString(payload.conversationId) &&
        isString(payload.messageId) &&
        ["sending", "sent", "delivered", "read", "failed"].includes(String(payload.status))
      );
    case "conversation.updated":
      return isConversation(payload.conversation);
    case "conversation.assigned":
      return isString(payload.conversationId) && isAgent(payload.agent);
    case "typing":
      return (
        isString(payload.conversationId) &&
        ["customer", "assistant", "agent"].includes(String(payload.side)) &&
        typeof payload.active === "boolean"
      );
    case "notice":
      return isString(payload.text);
    case "notification":
      return isNotification(payload.notification);
    default:
      return false;
  }
}
