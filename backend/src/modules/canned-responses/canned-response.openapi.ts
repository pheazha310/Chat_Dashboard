import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, pagedOf, successOf } from "@shared/openapi/envelopes.js";
import { createBody, listQuery, templateParams, updateBody } from "./canned-response.schema.js";
import type { CannedResponseDto } from "./canned-response.types.js";

// `satisfies` keeps the schema in step with the TypeScript DTO: drift fails the build.
const template = z
  .object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    shortcut: z.string().nullable(),
    scope: z.enum(["PERSONAL", "SHARED", "TEAM"]),
    createdBy: z.string(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    permissions: z.object({ canEdit: z.boolean() }),
  })
  .openapi("CannedResponse") satisfies z.ZodType<CannedResponseDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Canned responses"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] };

export function registerCannedResponseOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/canned-responses",
    tags,
    security,
    summary: "Available templates",
    description:
      "Your personal templates and the shared ones, active only, by title. `q` searches title, text and shortcut; `shortcut` finds one by what the agent typed; `includeInactive` also lists deactivated templates you could reactivate. Other agents' personal templates are never listed.",
    request: { query: listQuery },
    responses: {
      200: ok("A page of templates", pagedOf(template)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  });
  registry.registerPath({
    method: "post",
    path: "/canned-responses",
    tags,
    security,
    summary: "Create a template",
    description:
      "`scope` PERSONAL (default; private to you) or SHARED (supervisors/admins only; visible to everyone). `shortcut` like `/greeting` must be free among the templates you can see (409). TEAM templates are not available yet.",
    request: { body: jsonBody(createBody) },
    responses: { 201: ok("Created", successOf(template)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "get",
    path: "/canned-responses/{templateId}",
    tags,
    security,
    summary: "One template",
    description: "Someone else's personal template answers 404, as if it did not exist.",
    request: { params: templateParams },
    responses: { 200: ok("The template", successOf(template)), ...failures },
  });
  registry.registerPath({
    method: "patch",
    path: "/canned-responses/{templateId}",
    tags,
    security,
    summary: "Edit, deactivate or reactivate a template",
    description:
      "Your own personal template, or a shared one if you are a supervisor/admin (403 otherwise). The scope cannot change. `shortcut: null` removes the shortcut; `isActive` false/true deactivates/reactivates.",
    request: { params: templateParams, body: jsonBody(updateBody) },
    responses: { 200: ok("The template", successOf(template)), ...failures, 409: errors[409] },
  });
  registry.registerPath({
    method: "delete",
    path: "/canned-responses/{templateId}",
    tags,
    security,
    summary: "Deactivate a template",
    description:
      "Templates are never deleted: this deactivates it (same rights as editing) and frees its shortcut. Repeating it changes nothing.",
    request: { params: templateParams },
    responses: { 200: ok("The deactivated template", successOf(template)), ...failures },
  });
}
