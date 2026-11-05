import type { ConversationPermissions } from "@shared/policy/conversation-access.js";
import type { Conversation, Tag } from "../../../prisma/generated/prisma/client.js";

export type ConversationStatus = "OPEN" | "RESOLVED" | "CLOSED";
export type InboxFilter = "all" | "mine" | "unread" | "unassigned" | "archived";

export type ConversationWithTags = Conversation & { conversationTags: { tag: Tag }[] };
/** A conversation plus the caller's own open assignments (OWNER/VIEWER), used for access checks. */
export type AccessibleConversation = ConversationWithTags & { conversationAssignments: { assignmentType: string }[] };

export interface ConversationSummaryDto {
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerIdentifier: string | null;
  applicationId: string | null;
  subject: string | null;
  status: string;
  priority: string;
  conversationMode: string;
  handoffStatus: string;
  /** Backend 1 agent id; names and avatars come from Backend 1. */
  assignedAgentId: string | null;
  isArchived: boolean;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
  tags: { id: string; name: string; color: string | null }[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface ConversationDetailDto extends ConversationSummaryDto {
  summary: string | null;
  lastSequenceNumber: string;
  permissions: ConversationPermissions;
}

export interface ActivityDto {
  id: string;
  conversationId: string;
  actorType: string;
  actorId: string | null;
  activityType: string;
  description: string | null;
  metadata: unknown;
  createdAt: string;
}

export type { ConversationPermissions };
