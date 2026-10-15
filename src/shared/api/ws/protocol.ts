export type MessageSide = "customer" | "assistant" | "agent";
export type DeliveryStatus = "sending" | "sent" | "delivered" | "read" | "failed";
export type HandoffStatus = "ai" | "needs-human" | "assigned";

export type ChatMessageDto = {
  id: string;
  conversationId: string;
  side: MessageSide;
  text: string;
  createdAt: string;
  status?: DeliveryStatus;
};

export type ActivityDto = {
  id: string;
  tone: "blue" | "cyan" | "red";
  title: string;
  time: string;
  copy: string;
};

export type ConversationDto = {
  id: string;
  name: string;
  avatar: string;
  preview: string;
  lastMessageAt: string;
  unread: number;
  urgent: boolean;
  handoff: HandoffStatus;
  application: {
    appId: string;
    product: string;
    amount: string;
    tenor: string;
    status: string;
    reference: string;
  };
  activity: ActivityDto[];
  summary: string;
  summaryImage?: string;
};

/** Events the server pushes to the client. */
export type ServerEventMap = {
  sync: {
    conversations: ConversationDto[];
    messages: Record<string, ChatMessageDto[]>;
  };
  "message.new": { message: ChatMessageDto };
  "message.ack": { message: ChatMessageDto };
  "message.status": {
    conversationId: string;
    messageId: string;
    status: DeliveryStatus;
  };
  "conversation.updated": { conversation: ConversationDto };
  typing: { conversationId: string; side: MessageSide; active: boolean };
  notice: { text: string };
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
  isString(value.summary);
const isMessage = (value: unknown): value is ChatMessageDto =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.conversationId) &&
  (value.side === "customer" || value.side === "assistant" || value.side === "agent") &&
  isString(value.text) &&
  isString(value.createdAt) &&
  (value.status === undefined || ["sending", "sent", "delivered", "read", "failed"].includes(String(value.status)));

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
    case "typing":
      return (
        isString(payload.conversationId) &&
        ["customer", "assistant", "agent"].includes(String(payload.side)) &&
        typeof payload.active === "boolean"
      );
    case "notice":
      return isString(payload.text);
    default:
      return false;
  }
}
