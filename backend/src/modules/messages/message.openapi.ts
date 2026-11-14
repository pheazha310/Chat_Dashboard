import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { cursorPagedOf, errors, jsonBody, ok, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import { cursorQuery } from "@shared/utils/pagination.js";
import { messageParams, readBody, searchAllQuery, searchQuery, sendBody } from "./message.schema.js";
import type { AttachmentDto, MessageDto, PinDto, ReactionDto, ReadState } from "./message.types.js";

const nullableString = z.string().nullable();

// `satisfies` keeps the schemas in step with the TypeScript DTOs: drift fails the build.
export const reaction = z
  .object({ id: z.string(), userType: z.string(), userId: z.string(), emoji: z.string(), createdAt: z.string() })
  .openapi("MessageReaction") satisfies z.ZodType<ReactionDto>;

export const attachment = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    messageId: z.string().nullable(),
    kind: z.enum(["IMAGE", "DOCUMENT", "AUDIO", "VIDEO"]),
    filePath: z.string(),
    fileName: z.string(),
    mimeType: z.string(),
    fileSize: z.number().int(),
    durationMs: z.number().int().nullable(),
    waveform: z.array(z.number().int()).nullable(),
    uploadedByType: z.string(),
    uploadedById: z.string(),
    createdAt: z.string(),
    downloadPath: z.string(),
  })
  .openapi("Attachment") satisfies z.ZodType<AttachmentDto>;

export const message = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    clientId: nullableString,
    sequenceNumber: z.string(),
    senderType: z.enum(["CUSTOMER", "AGENT", "ASSISTANT", "SYSTEM"]),
    senderId: nullableString,
    type: z.string(),
    content: nullableString,
    metadata: z.unknown(),
    status: z.enum(["SENDING", "SENT", "DELIVERED", "READ", "FAILED"]),
    replyToMessageId: nullableString,
    forwardedFromMessageId: nullableString,
    isEdited: z.boolean(),
    editedAt: nullableString,
    reactions: z.array(reaction),
    attachments: z.array(attachment),
    createdAt: z.string(),
    deletedAt: nullableString.openapi({
      description: "Set on a deleted message, kept in history as a placeholder with no content, files or reactions",
    }),
  })
  .openapi("Message") satisfies z.ZodType<MessageDto>;

export const pin = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    messageId: z.string(),
    pinnedBy: z.string(),
    pinnedAt: z.string(),
    message,
  })
  .openapi("MessagePin") satisfies z.ZodType<PinDto>;

const readState = z
  .object({
    conversationId: z.string(),
    lastReadSequenceNumber: z.string(),
    markedUnread: z.boolean(),
    unreadCount: z.number().int(),
  })
  .openapi("ReadState") satisfies z.ZodType<ReadState>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Messages"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] };

export function registerMessageOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/messages",
    tags,
    security,
    summary: "Send a message",
    description:
      "Only the owning agent of an open conversation. Safe to retry: the same `clientId` returns the original message with 200 instead of creating a duplicate.",
    request: { params: idParams, body: jsonBody(sendBody) },
    responses: {
      201: ok("Created", successOf(message)),
      200: ok("Already sent with this clientId", successOf(message)),
      ...failures,
      409: errors[409],
    },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/messages",
    tags,
    security,
    summary: "Message history and reconnect sync",
    description:
      "Oldest to newest. No cursor returns the newest page; `before` pages back; `after` returns what was missed since a known `sequenceNumber`; `from` (a time) starts at the first message on or after it. Soft-deleted messages are excluded.",
    request: { params: idParams, query: cursorQuery },
    responses: { 200: ok("A page of messages", cursorPagedOf(message)), ...failures },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/messages/search",
    tags,
    security,
    summary: "Search messages in a conversation",
    description:
      "Case-insensitive text match, newest first. Deleted and SYSTEM messages never match; `reactions` and `attachments` are empty. Load the history around a hit with `after = sequenceNumber - 1`.",
    request: { params: idParams, query: searchQuery },
    responses: {
      200: ok(
        "Matching messages",
        z.object({
          status: z.literal("success"),
          data: z.array(message),
          meta: z.object({ limit: z.number().int(), hasMore: z.boolean() }),
        }),
      ),
      ...failures,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/pins",
    tags,
    security,
    summary: "Pinned messages",
    description:
      "The pin bar: messages pinned in this conversation, newest pin first, for everyone who can see it. Pinned messages that were deleted are left out. `reactions` and `attachments` of the message are empty. Staff only.",
    request: { params: idParams },
    responses: { 200: ok("Pins", successOf(z.array(pin))), ...failures },
  });
  registry.registerPath({
    method: "get",
    path: "/messages/search",
    tags,
    security,
    summary: "Search messages in every conversation the caller may open",
    description:
      "The inbox search. Each word matches a whole word or the start of one (`sal` finds `salary`), ignoring case; all words must match. Newest first. Deleted and SYSTEM messages never match. Each hit carries the message (empty `reactions` and `attachments`) and its customer.",
    request: { query: searchAllQuery },
    responses: {
      200: ok(
        "Matching messages with their conversation",
        z.object({
          status: z.literal("success"),
          data: z.array(
            z.object({
              message,
              conversation: z.object({
                id: z.string(),
                customerName: nullableString,
                customerIdentifier: nullableString,
              }),
            }),
          ),
          meta: z.object({ limit: z.number().int(), hasMore: z.boolean() }),
        }),
      ),
      400: errors[400],
      401: errors[401],
    },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/messages/{messageId}/delivered",
    tags,
    security,
    summary: "Record a delivery receipt",
    description:
      "For a customer message, recorded for the caller only. Status moves SENT to DELIVERED, never backwards.",
    request: { params: messageParams },
    responses: { 200: ok("The message", successOf(message)), ...failures },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/read",
    tags,
    security,
    summary: "Mark read",
    description:
      "Call only while the conversation is actually in view. Moves the caller's read position forward (never back) to `messageId` (default: the latest), records read receipts and marks those customer messages READ.",
    request: { params: idParams, body: jsonBody(readBody) },
    responses: { 200: ok("Read state", successOf(readState)), ...failures },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/unread",
    tags,
    security,
    summary: "Mark unread",
    description: "Flags the conversation unread for the caller (count is at least 1) without moving the read position.",
    request: { params: idParams },
    responses: { 200: ok("Read state", successOf(readState)), ...failures },
  });
}
