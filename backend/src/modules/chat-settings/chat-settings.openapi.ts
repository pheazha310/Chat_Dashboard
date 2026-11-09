import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, successOf } from "@shared/openapi/envelopes.js";
import { chatSettingsBody } from "./chat-settings.schema.js";
import type { ChatSettingsDto } from "./chat-settings.types.js";

// `satisfies` keeps the schema in step with the TypeScript DTO: drift fails the build.
const settings = z
  .object({
    typingSoundEnabled: z.boolean(),
    notificationSoundEnabled: z.boolean(),
    aiSuggestionsEnabled: z.boolean(),
    aiSummariesEnabled: z.boolean(),
    autoAssignEnabled: z.boolean(),
  })
  .openapi("ChatSettings") satisfies z.ZodType<ChatSettingsDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Chat settings"];

export function registerChatSettingsOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/agents/me/chat-settings",
    tags,
    security,
    summary: "My chat settings",
    description:
      "The caller's own switches. Defaults are returned until something was saved (sounds and AI on, auto-assign off); reading never creates a row.",
    responses: { 200: ok("Settings", successOf(settings)), 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "patch",
    path: "/agents/me/chat-settings",
    tags,
    security,
    summary: "Update my chat settings",
    description:
      "Partial update; omitted keys keep their value, unknown keys are rejected. Only the caller's settings can be changed. Broadcast to the caller's other sessions as `chat_settings.updated`. The AI and auto-assign switches are stored only: nothing reads them yet.",
    request: { body: jsonBody(chatSettingsBody) },
    responses: {
      200: ok("Settings", successOf(settings)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  });
}
