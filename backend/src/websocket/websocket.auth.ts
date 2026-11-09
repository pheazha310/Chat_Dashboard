import { ForbiddenError } from "@shared/errors/AppError.js";
import { DASHBOARD_ROLES, type AuthClient, type AuthContext } from "@shared/auth/auth.types.js";

/** Roles that may open a socket: dashboard staff, and customers (the mobile app) with a restricted event set. */
const SOCKET_ROLES = [...DASHBOARD_ROLES, "CUSTOMER"] as const;

/**
 * Verifies the token from the first `auth` frame (browsers cannot set headers on a WebSocket, and a token in the URL
 * would end up in logs). Customers may connect too, but see
 * only their own conversations and only the events in `customerView` (websocket.rooms.ts).
 */
export async function authenticateSocket(client: AuthClient, token: string): Promise<AuthContext> {
  const auth = await client.verifyToken(token);
  if (!(SOCKET_ROLES as readonly string[]).includes(auth.role))
    throw new ForbiddenError("Role not permitted on the socket");
  return auth;
}
