import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import { createEscalationBody, escalationParams, updateEscalationBody } from "./escalation.schema.js";
import type { EscalationDto } from "./escalation.types.js";

const escalation = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    requestedBy: z.string(),
    reason: z.string().nullable(),
    status: z.enum(["PENDING", "RESOLVED", "CANCELLED"]),
    resolvedBy: z.string().nullable(),
    createdAt: z.string(),
    resolvedAt: z.string().nullable(),
  })
  .openapi("Escalation") satisfies z.ZodType<EscalationDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Escalations"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] };

export function registerEscalationOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/escalations",
    tags,
    security,
    summary: "Escalation history",
    description: "Newest first, including resolved and cancelled ones.",
    request: { params: idParams },
    responses: { 200: ok("Escalations", successOf(z.array(escalation))), ...failures },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/escalations",
    tags,
    security,
    summary: "Escalate a conversation",
    description:
      "Only the owner of a conversation that is not closed. One escalation can be pending at a time (409). Adds an `ESCALATED` timeline entry and broadcasts `conversation.escalated` to everyone who can see the conversation. It does not change the owner, status or priority.",
    request: { params: idParams, body: jsonBody(createEscalationBody) },
    responses: { 201: ok("Created", successOf(escalation)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "patch",
    path: "/escalations/{escalationId}",
    tags,
    security,
    summary: "Resolve or cancel an escalation",
    description:
      "`RESOLVED`: supervisors and admins. `CANCELLED`: the requester or a supervisor. A closed escalation cannot change again (409). Broadcast as `conversation.escalated` with the new status.",
    request: { params: escalationParams, body: jsonBody(updateEscalationBody) },
    responses: { 200: ok("The escalation", successOf(escalation)), ...failures, 409: errors[409] },
  });
}
