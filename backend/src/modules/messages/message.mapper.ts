import { idToString } from "@shared/utils/ids.js";
import type {
  AttachmentDto,
  AttachmentRow,
  EditHistoryEntryDto,
  EditHistoryRow,
  MessageDto,
  MessageRow,
  ReactionDto,
  ReactionRow,
} from "./message.types.js";

const KIND_BY_PREFIX = [
  ["image/", "IMAGE"],
  ["audio/", "AUDIO"],
  ["video/", "VIDEO"],
] as const;

const waveformOf = (value: unknown): number[] | null =>
  Array.isArray(value) && value.every((n) => typeof n === "number") ? (value as number[]) : null;

export const toAttachment = (row: AttachmentRow, messageId: string | null = null): AttachmentDto => ({
  id: idToString(row.id),
  conversationId: idToString(row.conversationId),
  messageId,
  kind: KIND_BY_PREFIX.find(([prefix]) => row.mimeType.startsWith(prefix))?.[1] ?? "DOCUMENT",
  fileName: row.fileName,
  mimeType: row.mimeType,
  fileSize: Number(row.fileSize),
  durationMs: row.durationMs,
  waveform: waveformOf(row.waveform),
  uploadedByType: row.uploadedByType,
  uploadedById: idToString(row.uploadedById),
  createdAt: row.createdAt.toISOString(),
  downloadPath: `/attachments/${idToString(row.id)}/download`,
});

export const toReaction = (row: ReactionRow): ReactionDto => ({
  id: idToString(row.id),
  userType: row.userType,
  userId: idToString(row.userId),
  emoji: row.emoji,
  createdAt: row.createdAt.toISOString(),
});

export const toEditEntry = (row: EditHistoryRow): EditHistoryEntryDto => ({
  id: idToString(row.id),
  editorType: row.editorType,
  editorId: idToString(row.editorId),
  previousContent: row.previousContent,
  editedAt: row.editedAt.toISOString(),
});

export const toMessage = (
  row: MessageRow,
  reactions: ReactionRow[] = [],
  attachments: AttachmentDto[] = [],
): MessageDto => (row.deletedAt ? toPlaceholder(row, row.deletedAt) : toLiveMessage(row, reactions, attachments));

/** A deleted message keeps its place in the thread but nothing it said. */
const toPlaceholder = (row: MessageRow, deletedAt: Date): MessageDto => ({
  ...toLiveMessage(row, [], []),
  content: null,
  metadata: null,
  deletedAt: deletedAt.toISOString(),
});

const toLiveMessage = (row: MessageRow, reactions: ReactionRow[], attachments: AttachmentDto[]): MessageDto => ({
  id: idToString(row.id),
  conversationId: idToString(row.conversationId),
  clientId: row.clientId,
  sequenceNumber: row.sequenceNumber.toString(),
  senderType: row.senderType,
  senderId: row.senderId === null ? null : idToString(row.senderId),
  type: row.messageType,
  content: row.content,
  metadata: row.metadata,
  status: row.status,
  replyToMessageId: row.replyToMessageId === null ? null : idToString(row.replyToMessageId),
  forwardedFromMessageId: row.forwardedFromMessageId === null ? null : idToString(row.forwardedFromMessageId),
  isEdited: row.isEdited,
  editedAt: row.editedAt === null ? null : row.editedAt.toISOString(),
  reactions: reactions.map(toReaction),
  attachments,
  createdAt: row.createdAt.toISOString(),
  deletedAt: null,
});
