import type { Call } from "../rest/calls";
import type { ChatSettings } from "../rest/chat-settings";

export type MessageSide = "customer" | "assistant" | "agent" | "system";
export type DeliveryStatus = "sending" | "sent" | "delivered" | "read" | "failed";
export type HandoffStatus = "ai" | "needs-human" | "assigned";
export type ActivityTone = "blue" | "cyan" | "red";
export type FileKind = "document" | "image";
export type NotificationType = "new-conversation" | "handoff" | "callback" | "mention" | "system";

/// Application lifecycle status (consolidates ApplicationStatus from
/// ApplicationsTable.tsx and the status string on ConversationDto.application).
export type ApplicationStatus =
  | "New"
  | "Reviewing"
  | "Completed"
  | "Failed"
  | "Paid Off"
  | "in progress"
  | "overdue"
  /** The chat backend does not know loan data (Backend 1 owns it), so conversations from it carry this. */
  | "Unknown";

export type ChatMessageDto = {
  id: string;
  conversationId: string;
  side: MessageSide;
  text: string;
  createdAt: string;
  status?: DeliveryStatus;
  senderId?: string;
  /** The id the sending client generated; lets an optimistic message be matched to its server copy. */
  clientId?: string;
  /** Position in the conversation (a decimal string); orders messages and is the sync cursor. */
  sequence?: string;
  /** The message this one answers. */
  replyToId?: string;
  /** A copy made by "forward". */
  forwarded?: boolean;
  edited?: boolean;
  /** Soft-deleted: shown as "This message was deleted", with no text, files or reactions. */
  deleted?: boolean;
  reactions?: ReactionDto[];
  /** Files sent with the message. The bytes come from `downloadPath` with the bearer token. */
  attachments?: AttachmentDto[];
};

export type AttachmentDto = {
  id: string;
  kind: "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO";
  fileName: string;
  mimeType: string;
  size: number;
  durationMs?: number;
  waveform?: number[];
  downloadPath: string;
};

/** An internal note: staff only, never shown to the customer. */
export type NoteDto = {
  id: string;
  conversationId: string;
  authorId: string;
  authorName?: string;
  text: string;
  mentionedAgentIds: string[];
  edited: boolean;
  createdAt: string;
};

export type EscalationStatus = "PENDING" | "RESOLVED" | "CANCELLED";

export type ReactionDto = { id: string; userId: string; emoji: string };

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

export type Priority = "HIGH" | "MEDIUM" | "LOW";
export type TagRefDto = { id: string; name: string; color: string | null };

export type ConversationDto = {
  id: string;
  customerId?: string;
  name: string;
  avatar: string;
  preview: string;
  lastMessageAt: string;
  unread: number;
  urgent: boolean;
  /** Set by the real backend; the mock server only knows `urgent`. */
  priority?: Priority;
  tags?: TagRefDto[];
  handoff: HandoffStatus;
  assignedAgent?: AgentDto;
  application: ApplicationDto;
  activity: ActivityDto[];
  summary: string;
  summaryImage?: string;
  archived?: boolean;
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
  /** The conversation the notification is about, when it has one. */
  conversationId?: string | null;
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
    /**
     * True when `messages` holds only what the client was missing (everything after its cursors). The client merges
     * instead of replacing its message lists.
     */
    partial?: boolean;
    /** Conversations with more missed messages than fit in one sync; the client pages the rest. */
    incomplete?: string[];
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
  /** The conversation is no longer visible to this agent (someone else took it). */
  "conversation.removed": { conversationId: string };
  /** The authoritative unread count for the agent changed (read in another tab, marked unread, ...). */
  "conversation.unread": { conversationId: string; unread: number };
  /** A sent message could not be stored. `clientId` identifies the optimistic message. */
  "message.failed": { conversationId: string; clientId: string; reason?: string };
  typing: { conversationId: string; side: MessageSide; active: boolean };
  notice: { text: string };
  notification: { notification: NotificationDto };
  /** Another session of this agent read one notification (`notificationId` null: all), with the new unread total. */
  "notification.read": { notificationId: string | null; unreadCount: number };
  /** An existing message changed (edit). Replaces the held copy. */
  "message.updated": { message: ChatMessageDto };
  "message.deleted": { conversationId: string; messageId: string };
  "note.created": { note: NoteDto };
  "note.updated": { note: NoteDto };
  "note.deleted": { conversationId: string; noteId: string };
  /** A conversation was escalated, or an escalation was resolved or cancelled. */
  "conversation.escalated": {
    conversationId: string;
    escalationId: string;
    status: EscalationStatus;
    requestedBy: string;
    reason?: string;
  };
  /** A file was removed from a message. */
  "attachment.deleted": { conversationId: string; messageId: string | null; attachmentId: string };
  "message.reaction_updated": { conversationId: string; messageId: string; reactions: ReactionDto[] };
  /** Another window of this agent opened or closed a tab (docs/api-workspace.md). */
  "workspace.tab_opened": { conversationId: string; sortOrder: number; lastOpenedAt: string };
  "workspace.tab_closed": { conversationId: string };
  /** `content: null` means the draft was deleted. Ignore when `updatedAt` is older than the local edit. */
  "workspace.draft_updated": { conversationId: string; content: string | null; updatedAt: string };
  "workspace.preferences_updated": { preferences: { restoreTabs: boolean; persistTabs: boolean } };
  /** Another window of this agent changed its chat switches (docs/api-chat-settings.md). */
  "chat_settings.updated": { settings: ChatSettings };
  /** A customer is calling (docs/api-calls.md). Sent to everyone who may see the conversation. */
  "call.incoming": { call: Call };
  /** Someone answered. `by` tells the other windows whether it was them. */
  "call.accepted": { call: Call; by: { type: "AGENT" | "CUSTOMER"; id: string } };
  "call.declined": { call: Call; by: { type: "AGENT" | "CUSTOMER"; id: string } };
  /** `reason`: ended, cancelled, missed or timeout. */
  "call.ended": { call: Call; reason: string };
  /** Signalling from the other side of an answered call. `candidate: null` means no more candidates. */
  "call.offer": { callId: string; from: { type: string; id: string }; sdp: string };
  "call.answer": { callId: string; from: { type: string; id: string }; sdp: string };
  "call.ice_candidate": {
    callId: string;
    from: { type: string; id: string };
    candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null;
  };
};

/** Events the client sends to the server. */
export type ClientEventMap = {
  /**
   * `cursors` maps a conversation to the sequence number of the newest message the client holds, so a reconnect
   * brings back only what was missed. `selectedConversationId` gets its latest messages if it has no cursor.
   */
  "sync.request": { cursors?: Record<string, string>; selectedConversationId?: string };
  "message.send": { conversationId: string; clientId: string; text: string; replyToMessageId?: string };
  "conversation.read": { conversationId: string };
  "conversation.unread": { conversationId: string };
  "conversation.takeover": { conversationId: string };
  "callback.request": { conversationId: string };
  "call.offer": { callId: string; sdp: string };
  "call.answer": { callId: string; sdp: string };
  "call.ice_candidate": {
    callId: string;
    candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null;
  };
};

export type Envelope<T extends string = string, P = unknown> = { type: T; payload: P };

const CHAT_SETTING_KEYS: (keyof ChatSettings)[] = [
  "typingSoundEnabled",
  "notificationSoundEnabled",
  "aiSuggestionsEnabled",
  "aiSummariesEnabled",
  "autoAssignEnabled",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isCall = (value: unknown): boolean =>
  isRecord(value) && isString(value.id) && isString(value.conversationId) && isString(value.status);
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
  (value.customerId === undefined || isString(value.customerId)) &&
  (value.archived === undefined || typeof value.archived === "boolean");
const isMessage = (value: unknown): value is ChatMessageDto =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.conversationId) &&
  (value.side === "customer" || value.side === "assistant" || value.side === "agent" || value.side === "system") &&
  isString(value.text) &&
  isString(value.createdAt) &&
  (value.status === undefined || ["sending", "sent", "delivered", "read", "failed"].includes(String(value.status))) &&
  (value.senderId === undefined || isString(value.senderId)) &&
  (value.clientId === undefined || isString(value.clientId)) &&
  (value.sequence === undefined || isString(value.sequence));
const isNote = (value: unknown): value is NoteDto =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.conversationId) &&
  isString(value.authorId) &&
  isString(value.text) &&
  Array.isArray(value.mentionedAgentIds) &&
  typeof value.edited === "boolean" &&
  isString(value.createdAt);
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
        Object.values(payload.messages).every((messages) => Array.isArray(messages) && messages.every(isMessage)) &&
        (payload.partial === undefined || typeof payload.partial === "boolean") &&
        (payload.incomplete === undefined || (Array.isArray(payload.incomplete) && payload.incomplete.every(isString)))
      );
    case "message.new":
    case "message.ack":
    case "message.updated":
      return isMessage(payload.message);
    case "message.deleted":
      return isString(payload.conversationId) && isString(payload.messageId);
    case "note.created":
    case "note.updated":
      return isNote(payload.note);
    case "note.deleted":
      return isString(payload.conversationId) && isString(payload.noteId);
    case "conversation.escalated":
      return (
        isString(payload.conversationId) &&
        isString(payload.escalationId) &&
        isString(payload.requestedBy) &&
        ["PENDING", "RESOLVED", "CANCELLED"].includes(String(payload.status))
      );
    case "attachment.deleted":
      return (
        isString(payload.conversationId) &&
        isString(payload.attachmentId) &&
        (payload.messageId === null || isString(payload.messageId))
      );
    case "message.reaction_updated":
      return (
        isString(payload.conversationId) &&
        isString(payload.messageId) &&
        Array.isArray(payload.reactions) &&
        payload.reactions.every((r) => isRecord(r) && isString(r.id) && isString(r.userId) && isString(r.emoji))
      );
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
    case "conversation.removed":
      return isString(payload.conversationId);
    case "conversation.unread":
      return isString(payload.conversationId) && typeof payload.unread === "number" && payload.unread >= 0;
    case "message.failed":
      return (
        isString(payload.conversationId) &&
        isString(payload.clientId) &&
        (payload.reason === undefined || isString(payload.reason))
      );
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
    case "notification.read":
      return (
        (payload.notificationId === null || isString(payload.notificationId)) && typeof payload.unreadCount === "number"
      );
    case "workspace.tab_opened":
      return (
        isString(payload.conversationId) && typeof payload.sortOrder === "number" && isString(payload.lastOpenedAt)
      );
    case "workspace.tab_closed":
      return isString(payload.conversationId);
    case "workspace.draft_updated":
      return (
        isString(payload.conversationId) &&
        (payload.content === null || isString(payload.content)) &&
        isString(payload.updatedAt)
      );
    case "workspace.preferences_updated":
      return (
        isRecord(payload.preferences) &&
        typeof payload.preferences.restoreTabs === "boolean" &&
        typeof payload.preferences.persistTabs === "boolean"
      );
    case "chat_settings.updated":
      return (
        isRecord(payload.settings) &&
        CHAT_SETTING_KEYS.every((key) => typeof (payload.settings as Record<string, unknown>)[key] === "boolean")
      );
    case "call.incoming":
      return isCall(payload.call);
    case "call.accepted":
    case "call.declined":
      return isCall(payload.call) && isRecord(payload.by) && isString(payload.by.id);
    case "call.ended":
      return isCall(payload.call) && isString(payload.reason);
    case "call.offer":
    case "call.answer":
      return isString(payload.callId) && isRecord(payload.from) && isString(payload.sdp);
    case "call.ice_candidate":
      return (
        isString(payload.callId) &&
        isRecord(payload.from) &&
        (payload.candidate === null || (isRecord(payload.candidate) && isString(payload.candidate.candidate)))
      );
    default:
      return false;
  }
}
