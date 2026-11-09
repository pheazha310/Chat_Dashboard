import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errors, jsonBody, ok, successOf } from "@shared/openapi/envelopes.js";
import { roleParams, setRolePermissionsBody } from "./role.schema.js";
import type { PermissionDto, RoleDto } from "./role.types.js";

const role = z
  .object({
    id: z.number().int(),
    name: z.string(),
    kind: z.string(),
    description: z.string().nullable(),
    permissions: z.array(z.string()),
  })
  .openapi("Role") satisfies z.ZodType<RoleDto>;

const permission = z
  .object({ name: z.string(), module: z.string(), action: z.string(), description: z.string().nullable() })
  .openapi("Permission") satisfies z.ZodType<PermissionDto>;

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Roles"];

export function registerRoleOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/roles",
    tags,
    security,
    summary: "Roles and their permissions",
    description: "Needs `roles.read` (supervisors and admins by default).",
    responses: { 200: ok("Roles", successOf(z.array(role))), 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "get",
    path: "/permissions",
    tags,
    security,
    summary: "The permission catalogue",
    description: "Every permission a role can be given, as `module.action`. Needs `roles.read`.",
    responses: { 200: ok("Permissions", successOf(z.array(permission))), 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "put",
    path: "/roles/{roleId}/permissions",
    tags,
    security,
    summary: "Set a role's permissions",
    description:
      "Needs `roles.manage` (admins by default). Replaces the whole set. Customer roles cannot have any; ADMIN must keep `users.manage` and `roles.manage` (400). Applies to signed-in users within 60 s.",
    request: { params: roleParams, body: jsonBody(setRolePermissionsBody) },
    responses: {
      200: ok("The role", successOf(role)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
    },
  });
}
