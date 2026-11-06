import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, pagedOf, successOf } from "@shared/openapi/envelopes.js";
import {
  conversationTagParams,
  createTagBody,
  deleteTagQuery,
  listTagsQuery,
  setTagsBody,
  tagParams,
  updateTagBody,
} from "./tag.schema.js";
import type { ConversationTagsDto, TagDto } from "./tag.types.js";

// `satisfies` keeps the schemas in step with the TypeScript DTOs: drift fails the build.
const tag = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string().nullable(),
    createdBy: z.string().nullable(),
    usageCount: z.number().int(),
    createdAt: z.string(),
  })
  .openapi("Tag") satisfies z.ZodType<TagDto>;

const conversationTags = z
  .object({
    conversationId: z.string(),
    tags: z.array(z.object({ id: z.string(), name: z.string(), color: z.string().nullable() })),
  })
  .openapi("ConversationTags") satisfies z.ZodType<ConversationTagsDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Tags"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] };

export function registerTagOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/tags",
    tags,
    security,
    summary: "Available tags",
    description: "Alphabetical, with how many conversations use each. `q` searches the name.",
    request: { query: listTagsQuery },
    responses: { 200: ok("A page of tags", pagedOf(tag)), 400: errors[400], 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "post",
    path: "/tags",
    tags,
    security,
    summary: "Create a tag",
    description: "Any agent. The name is unique ignoring case (409). `color` is `#RRGGBB`.",
    request: { body: jsonBody(createTagBody) },
    responses: { 201: ok("Created", successOf(tag)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "patch",
    path: "/tags/{tagId}",
    tags,
    security,
    summary: "Rename or recolor a tag",
    description:
      "The tag's creator or a supervisor. `color: null` clears the color. Conversations using the tag receive `conversation.tags_updated`.",
    request: { params: tagParams, body: jsonBody(updateTagBody) },
    responses: { 200: ok("The tag", successOf(tag)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "delete",
    path: "/tags/{tagId}",
    tags,
    security,
    summary: "Delete a tag",
    description:
      "Supervisors only. A tag used by conversations is refused with 409 (`error.details.usageCount`) unless `force=true`, which takes it off every conversation first (a `TAG_REMOVED` timeline entry on each) and then deletes it.",
    request: { params: tagParams, query: deleteTagQuery },
    responses: {
      200: ok("Deleted", successOf(z.object({ id: z.string(), removedFromConversations: z.number().int() }))),
      ...failures,
      409: errors[409],
    },
  });
  registry.registerPath({
    method: "put",
    path: "/conversations/{id}/tags",
    tags,
    security,
    summary: "Set a conversation's tags",
    description:
      "Replaces the conversation's tags with `tagIds` (at most 20; an empty list removes all). The owner, a supervisor, or anyone while nobody owns the conversation (`permissions.canOrganize`). Unknown ids give 400. Additions and removals are recorded as `TAG_ADDED`/`TAG_REMOVED`, and `conversation.tags_updated` is broadcast. Idempotent.",
    request: { params: conversationTagParams, body: jsonBody(setTagsBody) },
    responses: { 200: ok("The conversation's tags", successOf(conversationTags)), ...failures },
  });
}
