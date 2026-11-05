import { idToString } from "@shared/utils/ids.js";
import type { ConversationActivity } from "../../../prisma/generated/prisma/client.js";
import type {
  ActivityDto,
  ConversationDetailDto,
  ConversationPermissions,
  ConversationSummaryDto,
  ConversationWithTags,
} from "./conversation.types.js";

const id = (value: bigint | null) => (value === null ? null : idToString(value));
const iso = (value: Date | null) => (value === null ? null : value.toISOString());

export function toSummary(row: ConversationWithTags, unreadCount: number): ConversationSummaryDto {
  return {
    id: idToString(row.id),
    customerId: id(row.customerId),
    customerName: row.customerName,
    customerIdentifier: row.customerIdentifier,
    applicationId: id(row.applicationId),
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    conversationMode: row.conversationMode,
    handoffStatus: row.handoffStatus,
    assignedAgentId: id(row.assignedAgentId),
    isArchived: row.isArchived,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastMessagePreview: row.lastMessagePreview,
    unreadCount,
    tags: row.conversationTags.map(({ tag }) => ({ id: idToString(tag.id), name: tag.name, color: tag.color })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: iso(row.resolvedAt),
    closedAt: iso(row.closedAt),
  };
}

export function toDetail(
  row: ConversationWithTags,
  unreadCount: number,
  permissions: ConversationPermissions,
): ConversationDetailDto {
  return {
    ...toSummary(row, unreadCount),
    summary: row.summary,
    lastSequenceNumber: idToString(row.lastSequenceNumber),
    permissions,
  };
}

export const toActivity = (row: ConversationActivity): ActivityDto => ({
  id: idToString(row.id),
  conversationId: idToString(row.conversationId),
  actorType: row.actorType,
  actorId: id(row.actorId),
  activityType: row.activityType,
  description: row.description,
  metadata: row.metadata,
  createdAt: row.createdAt.toISOString(),
});
