import { avatarFor } from "@/shared/lib/avatar";
import type {
  ActivityDto,
  ActivityTone,
  AgentDto,
  ChatMessageDto,
  ConversationDto,
  DeliveryStatus,
  HandoffStatus,
  MessageSide,
  NotificationDto,
  NotificationType,
  ReactionDto,
  AttachmentDto,
  NoteDto,
} from "../ws/protocol";
import type {
  BackendActivity,
  BackendAttachment,
  BackendAgentProfile,
  BackendConversation,
  BackendMessage,
  BackendNote,
  BackendNotification,
  BackendReaction,
} from "./types";

const UNKNOWN = "—";

const HANDOFF: Record<BackendConversation["handoffStatus"], HandoffStatus> = {
  NONE: "ai",
  NEEDS_HUMAN: "needs-human",
  ASSIGNED: "assigned",
};

const SIDE: Record<BackendMessage["senderType"], MessageSide> = {
  CUSTOMER: "customer",
  AGENT: "agent",
  ASSISTANT: "assistant",
  SYSTEM: "system",
};

export const toDeliveryStatus = (status: BackendMessage["status"]): DeliveryStatus =>
  status.toLowerCase() as DeliveryStatus;

export function toAgent(agent: BackendAgentProfile): AgentDto {
  return { id: agent.id, name: agent.name, avatar: agent.avatarUrl ?? avatarFor(agent.name), active: true };
}

/**
 * The chat backend knows only the conversation, not the loan behind it (Backend 1 owns that), so the application
 * block shows what is known (the id) and "—" for the rest instead of inventing values.
 */
export function toConversation(source: BackendConversation, unread: number): ConversationDto {
  const appId = source.applicationId === null ? UNKNOWN : String(source.applicationId);
  const name = source.customerName ?? (source.customerId ? `Customer ${source.customerId}` : "Conversation");
  return {
    id: source.id,
    ...(source.customerId ? { customerId: source.customerId } : {}),
    name,
    avatar: avatarFor(name),
    preview: source.lastMessagePreview ?? "",
    lastMessageAt: source.lastMessageAt,
    unread,
    urgent: source.priority === "HIGH",
    priority: source.priority,
    ...(source.tags?.length ? { tags: source.tags } : {}),
    handoff: HANDOFF[source.handoffStatus],
    ...(source.assignedAgent ? { assignedAgent: toAgent(source.assignedAgent) } : {}),
    application: {
      appId,
      product: UNKNOWN,
      amount: UNKNOWN,
      tenor: UNKNOWN,
      status: "Unknown",
      reference: appId,
    },
    activity: [],
    summary: source.summary ?? "",
    archived: source.isArchived,
  };
}

export function toMessage(source: BackendMessage): ChatMessageDto {
  return {
    id: source.id,
    conversationId: source.conversationId,
    side: SIDE[source.senderType],
    text: source.content ?? "",
    createdAt: source.createdAt,
    status: toDeliveryStatus(source.status),
    ...(source.senderId ? { senderId: source.senderId } : {}),
    ...(source.clientId ? { clientId: source.clientId } : {}),
    sequence: source.sequenceNumber,
    ...(source.replyToMessageId ? { replyToId: source.replyToMessageId } : {}),
    ...(source.forwardedFromMessageId ? { forwarded: true } : {}),
    ...(source.isEdited ? { edited: true } : {}),
    ...(source.deletedAt ? { deleted: true } : {}),
    ...(source.reactions?.length ? { reactions: source.reactions.map(toReaction) } : {}),
    ...(source.attachments?.length ? { attachments: source.attachments.map(toAttachment) } : {}),
  };
}

export const toAttachment = (source: BackendAttachment): AttachmentDto => ({
  id: source.id,
  kind: source.kind,
  fileName: source.fileName,
  mimeType: source.mimeType,
  size: source.fileSize,
  ...(source.durationMs === null ? {} : { durationMs: source.durationMs }),
  ...(source.waveform === null ? {} : { waveform: source.waveform }),
  downloadPath: source.downloadPath,
});

export const toNote = (source: BackendNote): NoteDto => ({
  id: source.id,
  conversationId: source.conversationId,
  authorId: source.authorAgentId,
  ...(source.author ? { authorName: source.author.name } : {}),
  text: source.content,
  mentionedAgentIds: source.mentionedAgentIds,
  edited: source.isEdited,
  createdAt: source.createdAt,
});

export const toReaction = (source: BackendReaction): ReactionDto => ({
  id: source.id,
  userId: source.userId,
  emoji: source.emoji,
});

const TONE: Record<string, ActivityTone> = {
  STATUS_CHANGED: "cyan",
  ARCHIVED: "cyan",
  RESTORED: "cyan",
  ESCALATED: "red",
  HANDOFF_REQUESTED: "red",
  MODERATION: "red",
};

const TITLE = (type: string) => {
  const words = type.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function toActivity(source: BackendActivity): ActivityDto {
  const time = new Date(source.createdAt);
  return {
    id: source.id,
    tone: TONE[source.activityType] ?? "blue",
    title: TITLE(source.activityType),
    time: time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
    copy: source.description ?? "",
  };
}

const NOTIFICATION_TYPE: Record<string, NotificationType> = {
  NEW_CONVERSATION: "new-conversation",
  HANDOFF: "handoff",
  ASSIGNED: "handoff",
  TRANSFERRED: "handoff",
  CALLBACK: "callback",
  MENTION: "mention",
};

export function toNotification(source: BackendNotification, agentId: string): NotificationDto {
  return {
    id: source.id,
    agentId,
    type: NOTIFICATION_TYPE[source.type] ?? "system",
    text: source.body ? `${source.title}: ${source.body}` : source.title,
    conversationId: source.conversationId,
    read: source.read,
    createdAt: source.createdAt,
  };
}
