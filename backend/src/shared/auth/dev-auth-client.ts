import { UnauthorizedError } from "@shared/errors/AppError.js";
import { ROLES, type AuthClient, type Role } from "./auth.types.js";

/**
 * DEVELOPMENT/TEST ONLY shortcut past sign-in. Accepts tokens of the form `dev:<userUuid>:<ROLE>`.
 * It is not a security mechanism: env.ts refuses AUTH_MODE=dev in production.
 */
export class DevAuthClient implements AuthClient {
  async verifyToken(token: string) {
    const match = /^dev:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}):([A-Z]+)$/.exec(
      token,
    );
    const role = match?.[2] as Role | undefined;
    if (!match || !role || !ROLES.includes(role)) throw new UnauthorizedError("Invalid token");
    return { userId: (match[1] as string).toLowerCase(), role };
  }
}
