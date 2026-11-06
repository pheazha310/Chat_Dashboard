import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, pagedOf, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import {
  blockBody,
  createKeywordBody,
  customerParams,
  keywordParams,
  listActivitiesQuery,
  listBlocksQuery,
  listKeywordsQuery,
  listReportsQuery,
  reportParams,
  reportSpamBody,
  reviewReportBody,
  updateKeywordBody,
} from "./moderation.schema.js";
import type { BlockDto, KeywordDto, ModerationActivityDto, SpamReportDto } from "./moderation.types.js";

// `satisfies` keeps the schemas in step with the TypeScript DTOs: drift fails the build.
const block = z
  .object({
    id: z.string(),
    customerId: z.string(),
    customerName: z.string().nullable(),
    blockedBy: z.string(),
    reason: z.string().nullable(),
    blockedAt: z.string(),
    unblockedAt: z.string().nullable(),
    unblockedBy: z.string().nullable(),
    permissions: z.object({ canUnblock: z.boolean() }),
  })
  .openapi("CustomerBlock") satisfies z.ZodType<BlockDto>;

const keyword = z
  .object({
    id: z.string(),
    keyword: z.string(),
    isActive: z.boolean(),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("BlockedKeyword") satisfies z.ZodType<KeywordDto>;

const report = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    reportedBy: z.object({ type: z.enum(["AGENT", "CUSTOMER"]), id: z.string() }),
    messageId: z.string().nullable(),
    reason: z.string(),
    status: z.enum(["PENDING", "CONFIRMED", "DISMISSED"]),
    reviewedBy: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    resolutionNote: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("SpamReport") satisfies z.ZodType<SpamReportDto>;

const activity = z
  .object({
    id: z.string(),
    actorId: z.string(),
    action: z.string(),
    targetType: z.enum(["CUSTOMER", "CONVERSATION", "MESSAGE", "KEYWORD", "SPAM_REPORT"]),
    targetId: z.string(),
    metadata: z.unknown(),
    createdAt: z.string(),
  })
  .openapi("ModerationActivity") satisfies z.ZodType<ModerationActivityDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Moderation"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] };

export function registerModerationOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/customer-block",
    tags,
    security,
    summary: "Block the conversation's customer",
    description:
      "The owner of the conversation, or a supervisor. The customer comes from the conversation. 409 if already blocked. Records the action in the moderation log and on the conversation timeline, and broadcasts `customer.blocked`. Open conversations stay open; the block stops what the customer does (messages, calls) once the customer channel exists.",
    request: { params: idParams, body: jsonBody(blockBody) },
    responses: { 201: ok("The block", successOf(block)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "post",
    path: "/moderation/customers/{customerId}/block",
    tags,
    security,
    summary: "Block a customer by id",
    description: "Supervisors only. 409 if already blocked.",
    request: { params: customerParams, body: jsonBody(blockBody) },
    responses: { 201: ok("The block", successOf(block)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "delete",
    path: "/moderation/customers/{customerId}/block",
    tags,
    security,
    summary: "Lift a block",
    description:
      "A supervisor, or the agent who blocked the customer. Anyone else gets 404 (they cannot tell whether the customer is blocked).",
    request: { params: customerParams },
    responses: { 200: ok("The lifted block", successOf(block)), ...failures },
  });
  registry.registerPath({
    method: "get",
    path: "/moderation/blocks",
    tags,
    security,
    summary: "Blocked customers",
    description:
      "Current blocks (`active=false` for lifted ones), newest first. Supervisors see all; an agent sees the blocks they made. `customerName` comes from Backend 1 and is null when it cannot be reached.",
    request: { query: listBlocksQuery },
    responses: { 200: ok("Blocks", pagedOf(block)), 400: errors[400], 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "get",
    path: "/moderation/keywords",
    tags,
    security,
    summary: "Blocked keywords",
    description:
      "Every keyword (active or not), alphabetical. Any dashboard user can read them. A message from a customer containing an active keyword (ignoring case) is stored and flagged for review, never rejected.",
    request: { query: listKeywordsQuery },
    responses: { 200: ok("Keywords", pagedOf(keyword)), 400: errors[400], 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "post",
    path: "/moderation/keywords",
    tags,
    security,
    summary: "Add a keyword",
    description: "Supervisors only. Unique ignoring case (409). At most 1000 active keywords.",
    request: { body: jsonBody(createKeywordBody) },
    responses: { 201: ok("The keyword", successOf(keyword)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "patch",
    path: "/moderation/keywords/{keywordId}",
    tags,
    security,
    summary: "Rename or switch a keyword",
    description: "Supervisors only. Takes effect within about 15 seconds on every API instance.",
    request: { params: keywordParams, body: jsonBody(updateKeywordBody) },
    responses: { 200: ok("The keyword", successOf(keyword)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "delete",
    path: "/moderation/keywords/{keywordId}",
    tags,
    security,
    summary: "Remove a keyword",
    description: "Supervisors only. Deletes it for good (the log keeps its text).",
    request: { params: keywordParams },
    responses: { 200: ok("Removed", successOf(z.object({ id: z.string() }))), ...failures },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/spam-reports",
    tags,
    security,
    summary: "Report spam or abuse",
    description:
      "Anyone who can see the conversation, about the conversation or one of its messages (`messageId`, which must belong to it). One pending report per reporter and target (409). Broadcast as `spam.reported` to whoever can see the conversation, which includes supervisors.",
    request: { params: idParams, body: jsonBody(reportSpamBody) },
    responses: { 201: ok("The report", successOf(report)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/spam-reports",
    tags,
    security,
    summary: "Spam reports of a conversation",
    description: "Anyone who can see the conversation. Newest first.",
    request: { params: idParams, query: pageQuery },
    responses: { 200: ok("Reports", pagedOf(report)), ...failures },
  });
  registry.registerPath({
    method: "get",
    path: "/moderation/spam-reports",
    tags,
    security,
    summary: "Spam report queue",
    description:
      "Supervisors see every report (filter by `status`, usually `PENDING`); an agent sees the ones they filed.",
    request: { query: listReportsQuery },
    responses: { 200: ok("Reports", pagedOf(report)), 400: errors[400], 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "patch",
    path: "/moderation/spam-reports/{reportId}",
    tags,
    security,
    summary: "Confirm or dismiss a report",
    description:
      "Supervisors only. A reviewed report cannot be reviewed again (409). With `CONFIRMED`, `blockCustomer: true` also blocks the conversation's customer in the same transaction (a customer who is already blocked stays blocked). Broadcast as `spam.reviewed`.",
    request: { params: reportParams, body: jsonBody(reviewReportBody) },
    responses: { 200: ok("The report", successOf(report)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "get",
    path: "/moderation/activities",
    tags,
    security,
    summary: "Moderation log",
    description:
      "Supervisors only. Who blocked, unblocked, reported, reviewed or changed keywords, newest first. Filter by `targetType` or `actorId`.",
    request: { query: listActivitiesQuery },
    responses: { 200: ok("Log", pagedOf(activity)), 400: errors[400], 401: errors[401], 403: errors[403] },
  });
}
