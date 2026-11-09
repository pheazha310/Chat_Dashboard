import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, successOf } from "@shared/openapi/envelopes.js";
import { conversationParams, draftBody, preferencesBody } from "./workspace.schema.js";
import type { DraftDto, OpenTabResult, WorkspacePreferencesDto } from "./workspace.types.js";

// `satisfies` keeps the schemas in step with the TypeScript DTOs: drift fails the build.
const preferences = z
  .object({ restoreTabs: z.boolean(), persistTabs: z.boolean() })
  .openapi("WorkspacePreferences") satisfies z.ZodType<WorkspacePreferencesDto>;

const draft = z
  .object({ conversationId: z.string(), content: z.string(), updatedAt: z.string() })
  .openapi("ConversationDraft") satisfies z.ZodType<DraftDto>;

const openTabResult = z
  .object({ conversationId: z.string(), persisted: z.boolean(), sortOrder: z.number().int().nullable() })
  .openapi("OpenTabResult") satisfies z.ZodType<OpenTabResult>;

const tab = z
  .object({
    conversationId: z.string(),
    sortOrder: z.number().int(),
    lastOpenedAt: z.string(),
    conversation: z.object({ id: z.string(), unreadCount: z.number().int() }).passthrough(),
  })
  .openapi("WorkspaceTab", { description: "`conversation` is the conversation summary from GET /conversations." });

const workspace = z.object({ preferences, tabs: z.array(tab), drafts: z.array(draft) }).openapi("Workspace");

const conversationOnly = z.object({ conversationId: z.string() });

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Workspace"];

export function registerWorkspaceOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/workspace",
    tags,
    security,
    summary: "My workspace",
    description:
      "Everything needed to restore the dashboard: tab preferences, the tabs left open (empty when `restoreTabs` is off) with each conversation's current state and this agent's unread count, and unsent drafts. Conversations the agent can no longer see are omitted.",
    responses: { 200: ok("Workspace", successOf(workspace)), 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "patch",
    path: "/workspace/preferences",
    tags,
    security,
    summary: "Update tab preferences",
    description: "Partial update; omitted keys keep their value. Broadcast as `workspace.preferences_updated`.",
    request: { body: jsonBody(preferencesBody) },
    responses: {
      200: ok("Preferences", successOf(preferences)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  });
  registry.registerPath({
    method: "put",
    path: "/workspace/tabs/{conversationId}",
    tags,
    security,
    summary: "Open a tab",
    description:
      "Idempotent: an open tab is only refreshed, so two windows never create a duplicate. Needs access to the conversation. With `persistTabs` off nothing is stored and `persisted` is false. At most 20 tabs (409). Broadcast as `workspace.tab_opened`. This never changes the conversation itself.",
    request: { params: conversationParams },
    responses: {
      200: ok("Tab", successOf(openTabResult)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
    },
  });
  registry.registerPath({
    method: "delete",
    path: "/workspace/tabs/{conversationId}",
    tags,
    security,
    summary: "Close a tab",
    description:
      "Idempotent. Only removes the tab: the conversation is not closed, resolved or archived. Broadcast as `workspace.tab_closed` when a tab was removed.",
    request: { params: conversationParams },
    responses: { 200: ok("Closed", successOf(conversationOnly)), 400: errors[400], 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "put",
    path: "/workspace/drafts/{conversationId}",
    tags,
    security,
    summary: "Save my draft",
    description:
      "Replaces my unsent text for this conversation (max 10000 characters). Drafts are per agent and conversation. An empty `content` deletes the draft and returns `null`. Broadcast as `workspace.draft_updated`.",
    request: { params: conversationParams, body: jsonBody(draftBody) },
    responses: {
      200: ok("Draft", successOf(draft.nullable())),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
    },
  });
  registry.registerPath({
    method: "delete",
    path: "/workspace/drafts/{conversationId}",
    tags,
    security,
    summary: "Discard my draft",
    description:
      "Idempotent. Call after the message was sent. Broadcast as `workspace.draft_updated` with `content: null`.",
    request: { params: conversationParams },
    responses: {
      200: ok("Discarded", successOf(conversationOnly)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  });
}
