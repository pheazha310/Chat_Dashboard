import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { ok, successOf } from "@shared/openapi/envelopes.js";
import type { HealthStatus } from "./health.types.js";

const check = z.enum(["up", "down"]);
// `satisfies` keeps the schema in step with the TypeScript type: drift fails the build.
const health = z
  .object({ status: z.enum(["ok", "degraded"]), database: check, redis: check })
  .openapi("Health") satisfies z.ZodType<HealthStatus>;

export function registerHealthOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/health",
    tags: ["Health"],
    summary: "Liveness and dependency check",
    description: "No authentication. Each dependency check times out after 2 s and is reported as `down`.",
    responses: {
      200: ok("Database and Redis are up", successOf(health)),
      503: ok("A dependency is down (`status` is `degraded`)", successOf(health)),
    },
  });
}
