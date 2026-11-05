import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import { listQuery, muteBody, preferencesBody } from "./notification.schema.js";
import type { NotificationDto, NotificationPreferencesDto } from "./notification.types.js";

const nullableString = z.string().nullable();

// `satisfies` keeps the schemas in step with the TypeScript DTOs: drift fails the build.
const notification = z
  .object({
    id: z.string(),
    type: z.enum([
      "NEW_MESSAGE",
      "NEW_CONVERSATION",
      "HANDOFF",
      "ASSIGNED",
      "TRANSFERRED",
      "MENTION",
      "CALLBACK",
      "CALL",
      "SYSTEM",
    ]),
    title: z.string(),
    body: nullableString,
    conversationId: nullableString,
    messageId: nullableString,
    read: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("Notification") satisfies z.ZodType<NotificationDto>;

const preferences = z
  .object({
    newMessage: z.boolean(),
    assignment: z.boolean(),
    transfer: z.boolean(),
    mention: z.boolean(),
    sound: z.boolean(),
    browser: z.boolean(),
  })
  .openapi("NotificationPreferences") satisfies z.ZodType<NotificationPreferencesDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Notifications"];
const base = { 401: errors[401], 403: errors[403] };

export function registerNotificationOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/notifications",
    tags,
    security,
    summary: "My notifications",
    description: "Newest first. `meta.unreadCount` is the caller's total unread, whatever the page or filter.",
    request: { query: listQuery },
    responses: {
      200: ok(
        "A page of notifications",
        z.object({
          status: z.literal("success"),
          data: z.array(notification),
          meta: z.object({
            total: z.number().int(),
            page: z.number().int(),
            size: z.number().int(),
            totalPages: z.number().int(),
            unreadCount: z.number().int(),
          }),
        }),
      ),
      400: errors[400],
      ...base,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/notifications/unread-count",
    tags,
    security,
    summary: "Unread badge count",
    responses: { 200: ok("Count", successOf(z.object({ unreadCount: z.number().int() }))), ...base },
  });
  registry.registerPath({
    method: "patch",
    path: "/notifications/{id}/read",
    tags,
    security,
    summary: "Mark one notification read",
    description: "Idempotent. Someone else's notification is 404. The agent's other sessions get `notification.read`.",
    request: { params: idParams },
    responses: { 200: ok("The notification", successOf(notification)), 400: errors[400], 404: errors[404], ...base },
  });
  registry.registerPath({
    method: "post",
    path: "/notifications/read-all",
    tags,
    security,
    summary: "Mark all my notifications read",
    responses: {
      200: ok("Result", successOf(z.object({ updated: z.number().int(), unreadCount: z.literal(0) }))),
      ...base,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/notifications/preferences",
    tags,
    security,
    summary: "My notification preferences",
    description: "All switches default to on. `sound` and `browser` are hints for the client (browser notifications).",
    responses: { 200: ok("Preferences", successOf(preferences)), ...base },
  });
  registry.registerPath({
    method: "put",
    path: "/notifications/preferences",
    tags,
    security,
    summary: "Change my notification preferences",
    description: "Send any subset of the switches. Switching a type off stops it being stored at all.",
    request: { body: jsonBody(preferencesBody) },
    responses: { 200: ok("Updated preferences", successOf(preferences)), 400: errors[400], ...base },
  });
  registry.registerPath({
    method: "put",
    path: "/conversations/{id}/mute",
    tags,
    security,
    summary: "Mute or unmute a conversation",
    description: "Stops new-message notifications for this conversation for the caller. Assignments still notify.",
    request: { params: idParams, body: jsonBody(muteBody) },
    responses: {
      200: ok("Result", successOf(z.object({ conversationId: z.string(), muted: z.boolean() }))),
      400: errors[400],
      404: errors[404],
      ...base,
    },
  });
}
