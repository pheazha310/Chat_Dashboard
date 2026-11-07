import { ForbiddenError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import type { IdentityResolver } from "@shared/ports/identity.js";
import type { ChatIdentityRepository } from "./chat-identity.repository.js";

/** CUSTOMER tokens map to customers; AGENT, SUPERVISOR and ADMIN are all staff. */
export const userTypeOf = (auth: AuthContext) => (auth.role === "CUSTOMER" ? "CUSTOMER" : "STAFF");

/**
 * Chat identity mapping. The identity itself always comes from the verified Backend 1 token (never from the request);
 * this only gives it an internal id and lets the chat side disable a user without touching Backend 1. The key is the
 * Backend 1 id, never the email.
 */
export class ChatIdentityService implements IdentityResolver {
  constructor(private readonly repository: ChatIdentityRepository) {}

  async resolve(auth: AuthContext) {
    const user = await this.repository.upsert(userTypeOf(auth), auth.userId, auth.role);
    if (user.status !== "ACTIVE") throw new ForbiddenError("This chat account is disabled");
    return { chatUserId: user.id };
  }
}
