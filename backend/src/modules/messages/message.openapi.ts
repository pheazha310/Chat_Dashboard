import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { cursorPagedOf, errors, jsonBody, ok, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import { cursorQuery } from "@shared/utils/pagination.js";
import { messageParams, readBody, sendBody } from "./message.schema.js";
import type { MessageDto, ReadState } from "./message.types.js";

const nullableString = z.string().nullable();

// `satisfies` keeps the schemas in step with the TypeScript DTOs: drift fails the build.
const message = z
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
    createdAt: z.string(),
  })
  .openapi("Message") satisfies z.ZodType<MessageDto>;

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
      "Oldest to newest. No cursor returns the newest page; `before` pages back; `after` returns what was missed since a known `sequenceNumber`. Soft-deleted messages are excluded.",
    request: { params: idParams, query: cursorQuery },
    responses: { 200: ok("A page of messages", cursorPagedOf(message)), ...failures },
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
