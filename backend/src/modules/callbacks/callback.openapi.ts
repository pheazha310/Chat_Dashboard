import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, pagedOf, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import {
  callbackParams,
  completeCallbackBody,
  createCallbackBody,
  listCallbacksQuery,
  updateCallbackBody,
} from "./callback.schema.js";
import type { CallbackDto } from "./callback.types.js";

// `satisfies` keeps the schema in step with the TypeScript DTO: drift fails the build.
const callback = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    customerId: z.string(),
    assignedAgentId: z.string().nullable(),
    createdBy: z.string().nullable(),
    scheduledAt: z.string(),
    status: z.enum(["PENDING", "COMPLETED", "CANCELLED", "MISSED"]),
    notes: z.string().nullable(),
    completionNote: z.string().nullable(),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
    permissions: z.object({ canEdit: z.boolean(), canComplete: z.boolean(), canCancel: z.boolean() }),
  })
  .openapi("Callback") satisfies z.ZodType<CallbackDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Callbacks"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] };

export function registerCallbackOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/callbacks",
    tags,
    security,
    summary: "My callbacks",
    description:
      "Callbacks assigned to me or scheduled by me, soonest first. Filters: `status`, `from`/`to` (scheduled time, ISO 8601 with offset). `scope=all` lists everyone's and is for supervisors (403 otherwise).",
    request: { query: listCallbacksQuery },
    responses: { 200: ok("Callbacks", pagedOf(callback)), 400: errors[400], 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/callbacks",
    tags,
    security,
    summary: "Callbacks of a conversation",
    description: "Every callback of the conversation in any status, soonest first. Needs access to the conversation.",
    request: { params: idParams },
    responses: { 200: ok("Callbacks", successOf(z.array(callback))), ...failures },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/callbacks",
    tags,
    security,
    summary: "Schedule a callback",
    description:
      "Anyone who can see the conversation. `scheduledAt` must be in the future (at most 365 days) and carry a UTC offset. The assignee defaults to the conversation's owner, else the caller; another agent must exist and be able to see the conversation. At most 20 pending per conversation (409). Notifies the assignee when it is someone else, adds a `CALLBACK` timeline entry and broadcasts `callback.created`.",
    request: { params: idParams, body: jsonBody(createCallbackBody) },
    responses: { 201: ok("Created", successOf(callback)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "get",
    path: "/callbacks/{callbackId}",
    tags,
    security,
    summary: "One callback",
    description: "Its assignee, its creator, supervisors, or anyone who can see the conversation. Otherwise 404.",
    request: { params: callbackParams },
    responses: { 200: ok("The callback", successOf(callback)), ...failures },
  });
  registry.registerPath({
    method: "patch",
    path: "/callbacks/{callbackId}",
    tags,
    security,
    summary: "Reschedule or reassign a callback",
    description:
      "Assignee, creator or supervisor, on a PENDING or MISSED callback (409 once completed or cancelled). A new `scheduledAt` makes it PENDING again and allows a new reminder. Changing `assignedAgentId` notifies the new assignee. Broadcast as `callback.updated`.",
    request: { params: callbackParams, body: jsonBody(updateCallbackBody) },
    responses: { 200: ok("The callback", successOf(callback)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "post",
    path: "/callbacks/{callbackId}/complete",
    tags,
    security,
    summary: "Mark a callback done",
    description:
      "Assignee, creator or supervisor. From PENDING or MISSED (a late call still counts). 409 if already closed. Broadcast as `callback.completed`.",
    request: { params: callbackParams, body: jsonBody(completeCallbackBody) },
    responses: { 200: ok("The callback", successOf(callback)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "post",
    path: "/callbacks/{callbackId}/cancel",
    tags,
    security,
    summary: "Cancel a callback",
    description:
      "Assignee, creator or supervisor. From PENDING or MISSED. 409 if already closed. Broadcast as `callback.cancelled`.",
    request: { params: callbackParams },
    responses: { 200: ok("The callback", successOf(callback)), ...failures, 409: errors[409] },
  });
}
