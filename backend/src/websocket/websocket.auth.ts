import { ForbiddenError } from "@shared/errors/AppError.js";
import { DASHBOARD_ROLES, type AuthClient, type AuthContext } from "@shared/auth/auth.types.js";

/**
 * Verifies the token from the first `auth` frame (browsers cannot set headers on a WebSocket, and a token in the URL
 * would end up in logs). Customers are refused: they use a separate channel.
 */
export async function authenticateSocket(client: AuthClient, token: string): Promise<AuthContext> {
  const auth = await client.verifyToken(token);
  if (!DASHBOARD_ROLES.includes(auth.role)) throw new ForbiddenError("Role not permitted on the dashboard socket");
  return auth;
}
