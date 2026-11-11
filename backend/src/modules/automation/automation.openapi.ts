import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, successOf } from "@shared/openapi/envelopes.js";
import { approvalBody, autoResponsesBody, exampleParams, trainingExampleBody } from "./automation.schema.js";
import type { AutoResponsesDto, TrainingExampleDto } from "./automation.types.js";

// `satisfies` keeps the schemas in step with the TypeScript DTOs: drift fails the build.
const autoResponses = z
  .object({ awayMessage: z.string().nullable(), firstResponse: z.string().nullable() })
  .openapi("AutoResponses") satisfies z.ZodType<AutoResponsesDto>;

const example = z
  .object({
    id: z.string(),
    customerMessage: z.string(),
    suggestedReply: z.string(),
    status: z.enum(["PENDING", "APPROVED"]),
    createdBy: z.string(),
    approvedBy: z.string().nullable(),
    approvedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("TrainingExample") satisfies z.ZodType<TrainingExampleDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Automation"];

export function registerAutomationOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/automation/auto-responses",
    tags,
    security,
    summary: "The automatic replies",
    description: "A text is `null` until the team saves one; nothing is sent for a trigger without a text.",
    responses: { 200: ok("Replies", successOf(autoResponses)), 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "put",
    path: "/automation/auto-responses",
    tags,
    security,
    summary: "Save the automatic replies",
    description:
      "Saves both texts and switches them on. Needs `automation.manage` (supervisors and admins). The first response is sent once when a customer opens a conversation; the away message when a customer writes and no agent is available, at most once an hour per conversation.",
    request: { body: jsonBody(autoResponsesBody) },
    responses: {
      200: ok("Replies", successOf(autoResponses)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  });
  registry.registerPath({
    method: "get",
    path: "/automation/training-examples",
    tags,
    security,
    summary: "AI training examples",
    description: "Newest first, pending and approved.",
    responses: { 200: ok("Examples", successOf(z.array(example))), 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "post",
    path: "/automation/training-examples",
    tags,
    security,
    summary: "Propose a training example",
    description: "Any staff user can propose one. It starts `PENDING` until a supervisor approves it.",
    request: { body: jsonBody(trainingExampleBody) },
    responses: { 201: ok("Created", successOf(example)), 400: errors[400], 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "patch",
    path: "/automation/training-examples/{exampleId}",
    tags,
    security,
    summary: "Approve or un-approve a training example",
    description: "Needs `automation.manage`. Approving records who and when; un-approving returns it to `PENDING`.",
    request: { params: exampleParams, body: jsonBody(approvalBody) },
    responses: {
      200: ok("Updated", successOf(example)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
    },
  });
}
