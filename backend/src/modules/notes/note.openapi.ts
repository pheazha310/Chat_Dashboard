import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, pagedOf, successOf } from "@shared/openapi/envelopes.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { createNoteBody, noteParams, updateNoteBody } from "./note.schema.js";
import type { NoteDto } from "./note.types.js";

// `satisfies` keeps the schema in step with the TypeScript DTO: drift fails the build.
const note = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    authorAgentId: z.string(),
    author: z.object({ id: z.string(), name: z.string(), avatarUrl: z.string().nullable() }).nullable(),
    content: z.string(),
    mentionedAgentIds: z.array(z.string()),
    isEdited: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    permissions: z.object({ canEdit: z.boolean(), canDelete: z.boolean() }),
  })
  .openapi("InternalNote") satisfies z.ZodType<NoteDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Internal notes"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] };

export function registerNoteOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/conversations/{id}/notes",
    tags,
    security,
    summary: "Internal notes of a conversation",
    description:
      "Newest first. Anyone who may see the conversation can read its notes. Notes are staff-only and are never part of message history or any customer-facing API.",
    request: { params: idParams, query: pageQuery },
    responses: { 200: ok("A page of notes", pagedOf(note)), ...failures },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations/{id}/notes",
    tags,
    security,
    summary: "Add an internal note",
    description:
      "Anyone who may see the conversation. `mentionedAgentIds` lists the agents to notify; each must exist in Backend 1 and be able to open the conversation (400 otherwise, `error.details.agentIds` names them). Mentioning yourself is ignored. Adds a `NOTE_ADDED` timeline entry (without the text). Broadcast as `note.created`, and `note.mentioned` plus a `MENTION` notification for each mentioned agent.",
    request: { params: idParams, body: jsonBody(createNoteBody) },
    responses: { 201: ok("Created", successOf(note)), ...failures },
  });
  registry.registerPath({
    method: "patch",
    path: "/notes/{noteId}",
    tags,
    security,
    summary: "Edit my note",
    description:
      "Author only. `text` and/or the complete new `mentionedAgentIds`; only agents added by this edit are notified. Broadcast as `note.updated`.",
    request: { params: noteParams, body: jsonBody(updateNoteBody) },
    responses: { 200: ok("The note", successOf(note)), ...failures },
  });
  registry.registerPath({
    method: "delete",
    path: "/notes/{noteId}",
    tags,
    security,
    summary: "Delete a note",
    description: "The author, or a supervisor/admin. Soft delete. Broadcast as `note.deleted`.",
    request: { params: noteParams },
    responses: {
      200: ok("Deleted", successOf(z.object({ id: z.string(), conversationId: z.string() }))),
      ...failures,
    },
  });
}
