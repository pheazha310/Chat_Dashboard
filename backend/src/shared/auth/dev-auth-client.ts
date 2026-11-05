import { UnauthorizedError } from "@shared/errors/AppError.js";
import { ROLES, type AuthClient, type Role } from "./auth.types.js";

/**
 * DEVELOPMENT/TEST ONLY stand-in for Backend 1. Accepts tokens of the form `dev:<numericUserId>:<ROLE>`.
 * It is not a security mechanism: env.ts refuses AUTH_MODE=dev in production.
 */
export class DevAuthClient implements AuthClient {
  async verifyToken(token: string) {
    const match = /^dev:(\d{1,18}):([A-Z]+)$/.exec(token);
    const role = match?.[2] as Role | undefined;
    if (!match || !role || !ROLES.includes(role)) throw new UnauthorizedError("Invalid token");
    return { userId: BigInt(match[1] as string), role };
  }
}
