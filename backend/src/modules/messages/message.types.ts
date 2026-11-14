import type {
  Attachment,
  Message,
  MessageEditHistory,
  MessagePin,
  MessageReaction,
} from "../../../prisma/generated/prisma/client.js";
import type { PolicyInput } from "@shared/policy/conversation-access.js";

export type MessageRow = Message;
export type ReactionRow = MessageReaction;
export type AttachmentRow = Attachment;
export type EditHistoryRow = MessageEditHistory;

/** Which customer a cross-conversation search hit belongs to (the inbox shows hits under the customer). */
export interface SearchHitConversation {
  id: string;
  customerName: string | null;
  customerIdentifier: string | null;
}
export type SearchAllRow = MessageRow & { conversation: SearchHitConversation };

export interface MessageDto {
  id: string;
  conversationId: string;
  /** Client-generated id the sender used; lets the client match its optimistic message. */
  clientId: string | null;
  /** Strictly increasing per conversation; the ordering and sync cursor. */
  sequenceNumber: string;
  senderType: string;
  senderId: string | null;
  type: string;
  content: string | null;
  metadata: unknown;
  /** Sender-facing summary: SENDING, SENT, DELIVERED, READ, FAILED. */
  status: string;
  replyToMessageId: string | null;
  /** Set on a copy made by "forward"; points at the original message. */
  forwardedFromMessageId: string | null;
  isEdited: boolean;
  editedAt: string | null;
  /** Every reaction on the message, oldest first. Group by `emoji` to show counts. */
  reactions: ReactionDto[];
  /** Files sent with the message. Fetch the bytes from `downloadPath`. */
  attachments: AttachmentDto[];
  createdAt: string;
  /** Set on a deleted message: it stays in history as a placeholder with no content, metadata, files or reactions. */
  deletedAt: string | null;
}

export interface AttachmentDto {
  id: string;
  conversationId: string;
  /** The message that carries it, or null if it is not linked to one. */
  messageId: string | null;
  kind: "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO";
  /** Where the file sits in storage (the storage key, e.g. `conversations/<id>/<uuid>.png`). Never a URL: bucket, host and signing stay private. */
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  durationMs: number | null;
  /** Bar heights 0 to 255 for drawing a voice message, when the recorder supplied them. */
  waveform: number[] | null;
  uploadedByType: string;
  uploadedById: string;
  createdAt: string;
  /** Path under the API base URL, e.g. `/attachments/<id>/download`. Needs the bearer token. */
  downloadPath: string;
}

export type PinRow = MessagePin & { message: MessageRow };

/** A message pinned to the top of the conversation for every agent (staff only). */
export interface PinDto {
  id: string;
  conversationId: string;
  messageId: string;
  pinnedBy: string;
  pinnedAt: string;
  message: MessageDto;
}

export interface ReactionDto {
  id: string;
  userType: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface EditHistoryEntryDto {
  id: string;
  editorType: string;
  editorId: string;
  /** The text before this edit. */
  previousContent: string;
  editedAt: string;
}

export interface MessageHistoryDto {
  messageId: string;
  conversationId: string;
  currentContent: string | null;
  /** Newest edit first. */
  edits: EditHistoryEntryDto[];
}

/** The conversation row as read under lock; carries what the policy and the customer path need. */
export interface LockedConversation extends PolicyInput {
  id: string;
  customerId: string | null;
  conversationType: string;
}

export interface MessagePage {
  items: MessageRow[];
  hasMore: boolean;
}

export interface ReadState {
  conversationId: string;
  lastReadSequenceNumber: string;
  markedUnread: boolean;
  unreadCount: number;
}
