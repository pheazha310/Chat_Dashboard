import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, ok, pagedOf, successOf } from "@shared/openapi/envelopes.js";
import { summary } from "@modules/conversations/conversation.openapi.js";
import { agentConversationsQuery } from "./profile.schema.js";
import type { AgentMeDto } from "./profile.types.js";

// `satisfies` keeps the schema in step with the TypeScript DTO: drift fails the build.
const agentMe = z
  .object({
    userId: z.string(),
    chatUserId: z.string().nullable(),
    role: z.string(),
    profile: z.object({ id: z.string(), name: z.string(), avatarUrl: z.string().nullable() }).nullable(),
    availability: z.string(),
  })
  .openapi("AgentMe") satisfies z.ZodType<AgentMeDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Agents"];

export function registerProfileOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/agents/me",
    tags,
    security,
    summary: "Who am I",
    description:
      "The signed-in staff user: Backend 1 id, chat user id, role, name and avatar from Backend 1 (null if unreachable) and availability (OFFLINE unless online; change it with `PUT /presence/me`).",
    responses: { 200: ok("The caller", successOf(agentMe)), 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "get",
    path: "/agents/me/conversations",
    tags,
    security,
    summary: "My conversations",
    description:
      "Conversations the caller owns (the inbox `mine` filter). Accepts the inbox filters except `filter`: `status`, `priority`, `tag`, `tags`, `sort`, `q`, `page`, `size`.",
    request: { query: agentConversationsQuery },
    responses: {
      200: ok("A page of conversations", pagedOf(summary)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  });
}
