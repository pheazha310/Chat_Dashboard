import type { RequestHandler } from "express";
import { ForbiddenError, UnauthorizedError } from "@shared/errors/AppError.js";
import { DASHBOARD_ROLES, type AuthClient, type AuthContext, type Role } from "@shared/auth/auth.types.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export const bearerToken = (header: string | undefined) => {
  const match = header ? /^Bearer (\S+)$/.exec(header) : null;
  return match?.[1];
};

/** Verifies the Backend 1 access token and attaches `req.auth`. Rejects non-dashboard roles. */
export function authenticate(client: AuthClient, allowed: readonly Role[] = DASHBOARD_ROLES): RequestHandler {
  return async (req, _res, next) => {
    const token = bearerToken(req.headers.authorization);
    if (!token) throw new UnauthorizedError("Missing bearer token");
    const auth = await client.verifyToken(token);
    if (!allowed.includes(auth.role)) throw new ForbiddenError("Role not permitted");
    req.auth = auth;
    next();
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new UnauthorizedError();
    if (!roles.includes(req.auth.role)) throw new ForbiddenError("Insufficient role");
    next();
  };
}

/** Controllers call this to get a non-optional identity after `authenticate` has run. */
export function getAuth(req: { auth?: AuthContext }): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}
