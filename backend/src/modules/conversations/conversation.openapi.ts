import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, pagedOf, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { createBody, listQuery, priorityBody, statusBody } from "./conversation.schema.js";
import type {
  ActivityDto,
  ConversationDetailDto,
  ConversationPermissions,
  ConversationSummaryDto,
} from "./conversation.types.js";

const nullableString = z.string().nullable();

const permissions: z.ZodType<ConversationPermissions> = z.object({
  canSendMessage: z.boolean(),
  canTakeOver: z.boolean(),
  canAssignOthers: z.boolean(),
  canTransfer: z.boolean(),
  canUnassign: z.boolean(),
  canResolve: z.boolean(),
  canClose: z.boolean(),
  canReopen: z.boolean(),
  canArchive: z.boolean(),
  canRestore: z.boolean(),
  canOrganize: z.boolean(),
});

const summaryShape = {
  id: z.string(),
  customerId: nullableString,
  customerName: nullableString,
  customerIdentifier: nullableString,
  applicationId: nullableString,
  subject: nullableString,
  status: z.enum(["OPEN", "RESOLVED", "CLOSED"]),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
  conversationMode: z.enum(["AI", "HUMAN"]),
  handoffStatus: z.enum(["NONE", "NEEDS_HUMAN", "ASSIGNED"]),
  assignedAgentId: nullableString,
  assignedAgent: z.object({ id: z.string(), name: z.string(), avatarUrl: nullableString }).nullable(),
  isArchived: z.boolean(),
  lastMessageAt: z.string(),
  lastMessagePreview: nullableString,
  unreadCount: z.number().int(),
  tags: z.array(z.object({ id: z.string(), name: z.string(), color: nullableString })),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: nullableString,
  closedAt: nullableString,
};

// `satisfies` keeps these response schemas in step with the TypeScript DTOs: drift fails the build.
const summary = z.object(summaryShape).openapi("ConversationSummary") satisfies z.ZodType<ConversationSummaryDto>;
const detail = z
  .object({ ...summaryShape, summary: nullableString, lastSequenceNumber: z.string(), permissions })
  .openapi("ConversationDetail") satisfies z.ZodType<ConversationDetailDto>;
const activity = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    actorType: z.string(),
    actorId: nullableString,
    activityType: z.string(),
    description: nullableString,
    metadata: z.unknown(),
    createdAt: z.string(),
  })
  .openapi("ConversationActivity") satisfies z.ZodType<ActivityDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Conversations"];

export function registerConversationOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/conversations",
    tags,
    security,
    summary: "Inbox",
    description:
      "Conversations the caller may see, newest activity first. `unassigned` means waiting in the shared queue. `q` matches customer name, identifier and customer id.",
    request: { query: listQuery },
    responses: {
      200: ok("A page of conversations", pagedOf(summary)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations",
    tags,
    security,
    summary: "Create or reuse a conversation",
    description:
      "Returns 201 when created, or 200 with the existing open conversation for the same application. The customer and application are not yet verified with Backend 1.",
    request: { body: jsonBody(createBody) },
    responses: {
      201: ok("Created", successOf(detail)),
      200: ok("Existing open conversation for the application", successOf(detail)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      409: errors[409],
    },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}",
    tags,
    security,
    summary: "Conversation detail",
    description: "Includes `unreadCount` for the caller and `permissions` describing what the caller may do now.",
    request: { params: idParams },
    responses: {
      200: ok("Conversation", successOf(detail)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
    },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/activities",
    tags,
    security,
    summary: "Activity history",
    request: { params: idParams, query: pageQuery },
    responses: {
      200: ok("A page of activities, newest first", pagedOf(activity)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
    },
  });
  registry.registerPath({
    method: "patch",
    path: "/conversations/{id}/priority",
    tags,
    security,
    summary: "Change priority",
    description:
      "HIGH, MEDIUM or LOW (new conversations start at MEDIUM). The owner, a supervisor, or anyone while nobody owns the conversation (`permissions.canOrganize`). The same value is a no-op. Adds a `PRIORITY_CHANGED` timeline entry and broadcasts `conversation.priority_changed`. Two simultaneous changes: one wins, the other gets 409.",
    request: { params: idParams, body: jsonBody(priorityBody) },
    responses: {
      200: ok("Updated conversation", successOf(detail)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
    },
  });
  registry.registerPath({
    method: "patch",
    path: "/conversations/{id}/status",
    tags,
    security,
    summary: "Resolve, close or reopen",
    description:
      "Resolve and close need the owner or a supervisor and release the agent. Reopen is open to anyone who can see the conversation and puts it back in the queue.",
    request: { params: idParams, body: jsonBody(statusBody) },
    responses: {
      200: ok("Updated conversation", successOf(detail)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
    },
  });
  for (const [action, summaryText] of [
    ["archive", "Archive"],
    ["restore", "Restore from archive"],
  ] as const) {
    registry.registerPath({
      method: "post",
      path: `/conversations/{id}/${action}`,
      tags,
      security,
      summary: summaryText,
      description: "Allowed for the owner, a supervisor, or anyone while the conversation is unassigned.",
      request: { params: idParams },
      responses: {
        200: ok("Updated conversation", successOf(detail)),
        400: errors[400],
        401: errors[401],
        403: errors[403],
        404: errors[404],
        409: errors[409],
      },
    });
  }
}
