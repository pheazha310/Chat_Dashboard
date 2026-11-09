import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { ROLES } from "@shared/auth/auth.types.js";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errorEnvelope, errors, jsonBody, ok, pagedOf, successOf } from "@shared/openapi/envelopes.js";
import {
  changePasswordBody,
  createUserBody,
  listUsersQuery,
  loginBody,
  refreshBody,
  resetPasswordBody,
  updateUserBody,
  userParams,
} from "./auth.schema.js";
import { USER_STATUSES, type AuthTokensDto, type UserDto } from "./auth.types.js";

// `satisfies` keeps the schemas in step with the TypeScript DTOs: drift fails the build.
const user = z
  .object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
    role: z.enum(ROLES),
    status: z.enum(USER_STATUSES),
    lastLoginAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("User") satisfies z.ZodType<UserDto>;

const tokens = z
  .object({
    tokenType: z.literal("Bearer"),
    accessToken: z.string(),
    accessTokenExpiresAt: z.string(),
    refreshToken: z.string(),
    refreshTokenExpiresAt: z.string(),
    user,
  })
  .openapi("AuthTokens") satisfies z.ZodType<AuthTokensDto>;

const security = [{ [BEARER_AUTH]: [] }];
const json = (description: string) => ({ description, content: { "application/json": { schema: errorEnvelope } } });
const tooMany = json(
  "Too many requests from this address (`Retry-After` header), or the account is locked (`ACCOUNT_LOCKED`)",
);
const noContent = { description: "Done" };

export function registerAuthOpenApi(registry: OpenAPIRegistry) {
  const tags = ["Auth"];
  registry.registerPath({
    method: "post",
    path: "/auth/login",
    tags,
    summary: "Sign in (staff)",
    description:
      "Agents, supervisors and admins. A wrong password, an unknown email and a customer account all answer the same 401. After 5 wrong passwords in a row the account is locked for 15 minutes (429 `ACCOUNT_LOCKED`). A disabled account answers 403 once the password is right.",
    request: { body: jsonBody(loginBody) },
    responses: {
      200: ok("Tokens", successOf(tokens)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      429: tooMany,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/auth/refresh",
    tags,
    summary: "New token pair",
    description:
      "Exchanges a refresh token for a new access token and a new refresh token; the old one stops working. Presenting a refresh token that was already used revokes the whole sign-in (send refreshes one at a time).",
    request: { body: jsonBody(refreshBody) },
    responses: { 200: ok("Tokens", successOf(tokens)), 400: errors[400], 401: errors[401], 429: tooMany },
  });
  registry.registerPath({
    method: "post",
    path: "/auth/logout",
    tags,
    summary: "Sign out this device",
    description: "Revokes the refresh token's sign-in. Always 204, also for an unknown token.",
    request: { body: jsonBody(refreshBody) },
    responses: { 204: noContent, 400: errors[400] },
  });
  registry.registerPath({
    method: "post",
    path: "/auth/logout-all",
    tags,
    security,
    summary: "Sign out everywhere",
    description:
      "Revokes every refresh token of the caller. Access tokens already issued expire on their own (15 minutes).",
    responses: { 204: noContent, 401: errors[401] },
  });
  registry.registerPath({
    method: "get",
    path: "/auth/me",
    tags,
    security,
    summary: "My account",
    responses: { 200: ok("Account", successOf(user)), 401: errors[401], 404: errors[404] },
  });
  registry.registerPath({
    method: "post",
    path: "/auth/me/password",
    tags,
    security,
    summary: "Change my password",
    description:
      "Needs the current password (403 if wrong; wrong guesses count toward the sign-in lock, 429). Rate-limited per user. Signs out every device and returns a new sign-in for this one.",
    request: { body: jsonBody(changePasswordBody) },
    responses: {
      200: ok("Tokens", successOf(tokens)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      429: tooMany,
    },
  });

  const userTags = ["Users"];
  registry.registerPath({
    method: "get",
    path: "/users",
    tags: userTags,
    security,
    summary: "List accounts",
    description: "Supervisors and admins. Filter by `role`, `status`, or `q` (email or name, case-insensitive).",
    request: { query: listUsersQuery },
    responses: { 200: ok("Accounts", pagedOf(user)), 400: errors[400], 401: errors[401], 403: errors[403] },
  });
  registry.registerPath({
    method: "post",
    path: "/users",
    tags: userTags,
    security,
    summary: "Create a staff account",
    description:
      "Admins only. Roles AGENT, SUPERVISOR or ADMIN; customers register themselves in the mobile app. 409 if the email is taken.",
    request: { body: jsonBody(createUserBody) },
    responses: {
      201: ok("Account", successOf(user)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      409: errors[409],
    },
  });
  registry.registerPath({
    method: "get",
    path: "/users/{userId}",
    tags: userTags,
    security,
    summary: "One account",
    description: "Supervisors and admins.",
    request: { params: userParams },
    responses: { 200: ok("Account", successOf(user)), 401: errors[401], 403: errors[403], 404: errors[404] },
  });
  registry.registerPath({
    method: "patch",
    path: "/users/{userId}",
    tags: userTags,
    security,
    summary: "Change an account",
    description:
      "Admins only. `displayName`, `role` (staff roles, staff accounts only) and `status`. Admins cannot change their own role or status. A new role or DISABLED signs the user out everywhere; re-enabling clears a sign-in lock.",
    request: { params: userParams, body: jsonBody(updateUserBody) },
    responses: {
      200: ok("Account", successOf(user)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
    },
  });
  registry.registerPath({
    method: "post",
    path: "/users/{userId}/password",
    tags: userTags,
    security,
    summary: "Set a new password",
    description: "Admins only. Clears a sign-in lock and signs the user out everywhere.",
    request: { params: userParams, body: jsonBody(resetPasswordBody) },
    responses: {
      200: ok("Account", successOf(user)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
    },
  });
}
