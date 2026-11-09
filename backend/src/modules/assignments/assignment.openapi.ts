import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import { assignBody, transferBody, unassignBody } from "./assignment.schema.js";
import type { AssignmentDto } from "./assignment.types.js";

const nullableString = z.string().nullable();

// `satisfies` keeps the schema in step with the TypeScript DTO: drift fails the build.
const assignment = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    agentId: z.string(),
    assignedBy: nullableString,
    type: z.enum(["OWNER", "VIEWER"]),
    action: z.enum(["TAKEOVER", "ASSIGNED", "TRANSFERRED", "AUTO_ASSIGNED"]),
    note: nullableString,
    assignedAt: z.string(),
    endedAt: nullableString,
    endedBy: nullableString,
  })
  .openapi("Assignment") satisfies z.ZodType<AssignmentDto>;

const released = z.object({ conversationId: z.string(), assignedAgentId: z.null() }).openapi("Unassigned");

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Assignments"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] };

export function registerAssignmentOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/assign",
    tags,
    security,
    summary: "Take over, or assign to an agent",
    description:
      "Without `agentId` the caller takes the conversation over (any agent for a waiting conversation; a supervisor for an AI-handled or owned one). With `agentId`, only supervisors may assign. If two agents claim at once, exactly one succeeds and the other gets 409. The target agent is not yet verified with Backend 1.",
    request: { params: idParams, body: jsonBody(assignBody) },
    responses: { 200: ok("The new ownership record", successOf(assignment)), ...failures },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/transfer",
    tags,
    security,
    summary: "Transfer to another agent",
    description: "The current owner or a supervisor hands the conversation to `agentId`. The new owner is notified.",
    request: { params: idParams, body: jsonBody(transferBody) },
    responses: { 200: ok("The new ownership record", successOf(assignment)), ...failures },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/unassign",
    tags,
    security,
    summary: "Return to the shared queue",
    request: { params: idParams, body: jsonBody(unassignBody) },
    responses: { 200: ok("Released", successOf(released)), ...failures },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/assignments",
    tags,
    security,
    summary: "Assignment history",
    description: "Every ownership record, newest first. Hidden (404) from agents who cannot see the conversation.",
    request: { params: idParams },
    responses: {
      200: ok("History", z.object({ status: z.literal("success"), data: z.array(assignment) })),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
    },
  });
}
