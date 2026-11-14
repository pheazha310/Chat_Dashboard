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
  losStaffBody,
  refreshBody,
  identityParams,
  linkIdentityBody,
  resetPasswordBody,
  updateUserBody,
  userParams,
} from "./auth.schema.js";
import { USER_STATUSES, type AuthTokensDto, type UserDto } from "./auth.types.js";

// `satisfies` keeps the schemas in step with the TypeScript DTOs: drift fails the build.
const staffProfile = z
  .object({
    employeeCode: z.string().nullable(),
    department: z.string().nullable(),
    maxConcurrentChats: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "Most open chats this person should own at once; null = no limit. Not yet enforced" }),
  })
  .openapi("StaffProfile");

const customerProfile = z
  .object({
    phone: z.string().nullable().openapi({ description: "E.164, e.g. +85512345678" }),
    customerCode: z.string().nullable().openapi({ description: "The customer's code in the loan system (LOS)" }),
    preferredLanguage: z.string().nullable().openapi({ description: "BCP 47 tag, e.g. km or en" }),
  })
  .openapi("CustomerProfile");

const user = z
  .object({
    id: z.string(),
    username: z
      .string()
      .nullable()
      .openapi({ description: "The sign-in name; null for an account that only signs in with LOS" }),
    email: z.string().nullable().openapi({ description: "Optional contact address; not used to sign in" }),
    losUserId: z.number().int().nullable().openapi({ description: "The LOS userId when the account is linked to LOS" }),
    displayName: z.string(),
    role: z.enum(ROLES),
    status: z.enum(USER_STATUSES),
    lastLoginAt: z.string().nullable(),
    createdAt: z.string(),
    staff: staffProfile.nullable().openapi({ description: "Staff accounts only; null for customers" }),
    customer: customerProfile.nullable().openapi({ description: "Customer accounts only; null for staff" }),
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
      "Agents, supervisors and admins. With LOS configured the username and password are tried against LOS first (the LOS access token is verified, role from LOS), then as a chat account. A wrong password, an unknown username and a customer account all answer the same 401. After 5 wrong passwords in a row the account is locked for 15 minutes (429 `ACCOUNT_LOCKED`). A disabled account answers 403 once the password is right.",
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
    path: "/auth/los",
    tags,
    summary: "Sign in with LOS (staff)",
    description:
      "Exchanges the short-lived LOS staff hand-off token (RS256, `aud` = LOS_HANDOFF_AUDIENCE, `type` = staff, `tokenType` = LOS_HANDOFF_TOKEN_TYPE, a staff `role`) for this backend's tokens. The account is found by its LOS userId or created without username or password; the role follows LOS on every sign-in. Any problem with the token is the same 401. 503 `LOS_SIGN_IN_DISABLED` when LOS is not configured. The mobile app uses `POST /api/v1/customer/auth/los` with `{ losToken }`.",
    request: { body: jsonBody(losStaffBody) },
    responses: {
      200: ok("Tokens", successOf(tokens)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      429: tooMany,
      503: json("Sign in with LOS is not configured (`LOS_SIGN_IN_DISABLED`)"),
    },
  });
  registry.registerPath({
    method: "post",
    path: "/auth/refresh",
    tags,
    summary: "New token pair",
    description:
      "Exchanges a refresh token for a new access token and a new refresh token; the old one stops working. The new refresh token keeps the sign-in's original expiry: refreshing never extends a sign-in. Presenting a refresh token that was already used revokes the whole sign-in (send refreshes one at a time).",
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
      "Revokes every refresh token of the caller. Access tokens already issued expire on their own (STAFF_ACCESS_TOKEN_TTL_SECONDS, 15 minutes by default).",
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
      "Needs the current password (403 if wrong; wrong guesses count toward the sign-in lock, 429). Rate-limited per user. Signs out every device and returns a new sign-in for this one. 409 for an account that signs in with LOS and has no password.",
    request: { body: jsonBody(changePasswordBody) },
    responses: {
      200: ok("Tokens", successOf(tokens)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      409: errors[409],
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
    description:
      "Supervisors and admins. Filter by `role`, `status`, or `q` (username, email or name, case-insensitive). `chatLogin=false` lists accounts with no chat password (LOS-only, who cannot sign in while LOS is down); `chatLogin=true` the others.",
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
      "Admins only. Roles AGENT, SUPERVISOR or ADMIN; customers register themselves in the mobile app. Optional `staff` fields (employeeCode, department, maxConcurrentChats) fill the account's `staff` row. 409 if the username or the employee code is taken.",
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
      "Admins only. `displayName`, `role` (staff roles, staff accounts only), `status`, and the profile: `staff` (staff accounts) or `customer` (customer accounts; phone, customerCode, preferredLanguage), where null clears a field and 400 is the wrong kind of account. Admins cannot change their own role or status. A new role or DISABLED signs the user out everywhere; re-enabling clears a sign-in lock. 409 for a new role on an LOS account (LOS sets its role at every sign-in) or a taken employee or customer code.",
    request: { params: userParams, body: jsonBody(updateUserBody) },
    responses: {
      200: ok("Account", successOf(user)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
    },
  });
  registry.registerPath({
    method: "post",
    path: "/users/{userId}/identities",
    tags: userTags,
    security,
    summary: "Link an account to an LOS identity",
    description:
      "Admins only. Maps this chat account to a person's LOS userId, so their LOS sign-in lands here instead of creating a second account. Never matched by name, email or phone. The identity type must match the account (CUSTOMER or STAFF). 409 when the identity belongs to another account or this account already has one. From then on LOS sets the account's role on every LOS sign-in.",
    request: { params: userParams, body: jsonBody(linkIdentityBody) },
    responses: {
      201: ok("Account", successOf(user)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
    },
  });
  registry.registerPath({
    method: "delete",
    path: "/users/{userId}/identities/{provider}",
    tags: userTags,
    security,
    summary: "Unlink an account from LOS",
    description:
      "Admins only. Removes the LOS mapping and signs the account out everywhere. The account keeps its chat username and password. 409 when LOS is its only sign-in; 404 when it has no LOS identity.",
    request: { params: identityParams },
    responses: {
      200: ok("Account", successOf(user)),
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
    },
  });
  registry.registerPath({
    method: "post",
    path: "/users/{userId}/password",
    tags: userTags,
    security,
    summary: "Set a new password",
    description:
      "Admins only. Clears a sign-in lock and signs the user out everywhere. For an LOS-only account (no username yet) send `username` too: the same account then gets chat credentials and can sign in standalone; without it, 409. An account that already has a username cannot be renamed here (400); 409 for a taken username.",
    request: { params: userParams, body: jsonBody(resetPasswordBody) },
    responses: {
      200: ok("Account", successOf(user)),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
    },
  });
}
