export const ROLES = ["CUSTOMER", "AGENT", "SUPERVISOR", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Roles allowed on the dashboard (REST and WebSocket). Customers use a separate channel. */
export const DASHBOARD_ROLES: readonly Role[] = ["AGENT", "SUPERVISOR", "ADMIN"];

/** Identity resolved from the Backend 1 access token. Ids are Backend 1 ids (no FK in this database). */
export interface AuthContext {
  userId: string;
  role: Role;
}

/**
 * Port to the external auth service (Backend 1). The real contract (token format, verify endpoint, claims) is not
 * known yet, so only this interface is fixed. Implementations must throw UnauthorizedError for any invalid token.
 */
export interface AuthClient {
  verifyToken(token: string): Promise<AuthContext>;
}

export const isSupervisor = (auth: AuthContext) => auth.role === "SUPERVISOR" || auth.role === "ADMIN";
