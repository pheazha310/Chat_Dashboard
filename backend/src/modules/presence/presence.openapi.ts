import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, successOf } from "@shared/openapi/envelopes.js";
import { setPresenceBody } from "./presence.schema.js";
import type { PresenceDto } from "./presence.types.js";

// `satisfies` keeps the schema in step with the TypeScript DTO: drift fails the build.
const presence = z
  .object({ userId: z.string(), status: z.enum(["AVAILABLE", "BUSY", "AWAY", "OFFLINE"]) })
  .openapi("Presence") satisfies z.ZodType<PresenceDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Presence"];

export function registerPresenceOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/presence",
    tags,
    security,
    summary: "Agents who are online",
    description: "Agents with at least one open WebSocket and the status they chose. Offline agents are not listed.",
    responses: {
      200: ok("Online agents", z.object({ status: z.literal("success"), data: z.array(presence) })),
      401: errors[401],
      403: errors[403],
    },
  });
  registry.registerPath({
    method: "put",
    path: "/presence/me",
    tags,
    security,
    summary: "Set my status",
    description:
      "AVAILABLE, BUSY or AWAY. Remembered for the next connection; broadcast as `presence.updated` while online. Offline is derived and cannot be set.",
    request: { body: jsonBody(setPresenceBody) },
    responses: {
      200: ok("My effective status", successOf(presence)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  });
}
