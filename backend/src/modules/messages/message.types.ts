import type { Message } from "../../../prisma/generated/prisma/client.js";
import type { PolicyInput } from "@shared/policy/conversation-access.js";

export type MessageRow = Message;

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
  createdAt: string;
}

/** The conversation row as read under lock; carries what the policy and the customer path need. */
export interface LockedConversation extends PolicyInput {
  id: string;
  customerId: string | null;
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
