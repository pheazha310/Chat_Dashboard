import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, successOf } from "@shared/openapi/envelopes.js";
import {
  editBody,
  forwardBody,
  messageIdParams,
  reactionBody,
  reactionParams,
  replyBody,
} from "./message-action.schema.js";
import { message, pin, reaction } from "./message.openapi.js";
import type { MessageHistoryDto } from "./message.types.js";

const history = z
  .object({
    messageId: z.string(),
    conversationId: z.string(),
    currentContent: z.string().nullable(),
    edits: z.array(
      z.object({
        id: z.string(),
        editorType: z.string(),
        editorId: z.string(),
        previousContent: z.string(),
        editedAt: z.string(),
      }),
    ),
  })
  .openapi("MessageEditHistory") satisfies z.ZodType<MessageHistoryDto>;

const deleted = z
  .object({ id: z.string(), conversationId: z.string(), deletedAt: z.string(), deletedBy: z.string() })
  .openapi("DeletedMessage");

const reactions = z.object({ reactions: z.array(reaction) });

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Message actions"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] };

export function registerMessageActionOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "put",
    path: "/messages/{messageId}/pin",
    tags,
    security,
    summary: "Pin a message",
    description:
      "Pins the message to the top of its conversation for every agent. Allowed for the owner or a supervisor, or anyone while nobody owns the conversation. Pinning a pinned message changes nothing. SYSTEM messages cannot be pinned; at most 10 pins per conversation (409).",
    request: { params: messageIdParams },
    responses: { 200: ok("The pin", successOf(pin)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "delete",
    path: "/messages/{messageId}/pin",
    tags,
    security,
    summary: "Unpin a message",
    description: "Same permission as pinning. Unpinning a message that is not pinned changes nothing.",
    request: { params: messageIdParams },
    responses: { 200: ok("Unpinned", successOf(z.null())), ...failures },
  });
  registry.registerPath({
    method: "post",
    path: "/messages/{messageId}/replies",
    tags,
    security,
    summary: "Reply to a message",
    description:
      "Sends an agent message with `replyToMessageId` set. Same rules as sending (owner of an open conversation) and same idempotency by `clientId`. Delivered as `message.new`.",
    request: { params: messageIdParams, body: jsonBody(replyBody) },
    responses: {
      201: ok("Created", successOf(message)),
      200: ok("Already sent with this clientId", successOf(message)),
      ...failures,
      409: errors[409],
    },
  });
  registry.registerPath({
    method: "patch",
    path: "/messages/{messageId}",
    tags,
    security,
    summary: "Edit my message",
    description:
      "Author only, text messages only, while the caller still owns the open conversation. The previous text is saved in the edit history. Unchanged text is a no-op. Broadcast as `message.updated`.",
    request: { params: messageIdParams, body: jsonBody(editBody) },
    responses: { 200: ok("The edited message", successOf(message)), ...failures },
  });
  registry.registerPath({
    method: "delete",
    path: "/messages/{messageId}",
    tags,
    security,
    summary: "Delete a message",
    description:
      "Soft delete (the row and its history are kept). Authors delete their own messages; supervisors and admins any agent, AI or customer message. SYSTEM messages cannot be deleted. Broadcast as `message.deleted`.",
    request: { params: messageIdParams },
    responses: { 200: ok("Deleted", successOf(deleted)), ...failures },
  });
  registry.registerPath({
    method: "get",
    path: "/messages/{messageId}/history",
    tags,
    security,
    summary: "Edit history",
    description: "Earlier versions, newest edit first. Only the author and supervisors may read it.",
    request: { params: messageIdParams },
    responses: { 200: ok("Edit history", successOf(history)), ...failures },
  });
  registry.registerPath({
    method: "put",
    path: "/messages/{messageId}/reactions",
    tags,
    security,
    summary: "React with an emoji",
    description:
      "Idempotent: the same emoji twice keeps one reaction. At most 10 different emojis per user and message (409). Anyone who can see the conversation may react. Broadcast as `message.reaction_updated`.",
    request: { params: messageIdParams, body: jsonBody(reactionBody) },
    responses: {
      200: ok("My reaction and all reactions", successOf(z.object({ reaction, reactions: z.array(reaction) }))),
      ...failures,
      409: errors[409],
    },
  });
  registry.registerPath({
    method: "delete",
    path: "/messages/{messageId}/reactions/{reactionId}",
    tags,
    security,
    summary: "Remove my reaction",
    description: "Only the reaction's owner (403 otherwise). Broadcast as `message.reaction_updated`.",
    request: { params: reactionParams },
    responses: { 200: ok("Remaining reactions", successOf(reactions)), ...failures },
  });
  registry.registerPath({
    method: "post",
    path: "/messages/{messageId}/forwards",
    tags,
    security,
    summary: "Forward a message",
    description:
      "Copies a text message into another conversation the caller owns and that is open, keeping `forwardedFromMessageId`. Allowed only within the same customer's conversations or into an internal conversation. Idempotent by `clientId`. Broadcast as `message.new` plus `message.forwarded`.",
    request: { params: messageIdParams, body: jsonBody(forwardBody) },
    responses: {
      201: ok("Created", successOf(message)),
      200: ok("Already forwarded with this clientId", successOf(message)),
      ...failures,
      409: errors[409],
    },
  });
}
