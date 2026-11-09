export const ROLES = ["CUSTOMER", "AGENT", "SUPERVISOR", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Roles allowed on the dashboard (REST and WebSocket). Customers use a separate channel. */
export const DASHBOARD_ROLES: readonly Role[] = ["AGENT", "SUPERVISOR", "ADMIN"];

/** Identity resolved from a verified access token. `userId` is `users.id` (the token's `sub`). */
export interface AuthContext {
  userId: string;
  role: Role;
  /** This backend's own id for the user (`chat_users.id`), set once the identity is mapped. Other tables still key on `userId`. */
  chatUserId?: string;
  /**
   * What the role may do (`role_permissions`), loaded with the identity and cached for `IDENTITY_CACHE_MS`. Absent on
   * contexts that were not resolved (tests): `can()` then uses the default grants. Check with `can()`, not directly.
   */
  permissions?: ReadonlySet<string>;
}

/**
 * Verifies an access token. Implemented by `AccessTokens` (modules/auth) and, for development, `DevAuthClient`.
 * Implementations must throw UnauthorizedError for any invalid token.
 */
export interface AuthClient {
  verifyToken(token: string): Promise<AuthContext>;
}
