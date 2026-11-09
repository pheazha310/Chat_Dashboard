import { ForbiddenError } from "@shared/errors/AppError.js";
import type { AuthContext, Role } from "@shared/auth/auth.types.js";
import type { IdentityResolver } from "@shared/ports/identity.js";
import type { ChatIdentityRepository } from "./chat-identity.repository.js";

/**
 * Chat identity mapping. The identity itself always comes from the verified access token (never from the request);
 * this gives it an internal id, loads what its role may do (`role_permissions`) and lets a user be refused on every
 * request once disabled. The key is the token's user id (`users.id`), never the email.
 */
export class ChatIdentityService implements IdentityResolver {
  constructor(private readonly repository: ChatIdentityRepository) {}

  async resolve(auth: AuthContext) {
    const user = await this.repository.upsert(auth.userId, auth.role);
    if (user.status !== "ACTIVE") throw new ForbiddenError("This chat account is disabled");
    const permissions = new Set(
      user.role.rolePermissions.map(({ permission }) => `${permission.module}.${permission.action}`),
    );
    return { chatUserId: user.id, permissions };
  }

  /** Makes sure a customer has a chat identity before rows that reference it (a conversation) are written. */
  async ensureCustomer(customerId: string): Promise<void> {
    await this.repository.ensure(customerId, "CUSTOMER");
  }

  /** Called when an account is created, renamed or given another role, and on sign-in: keeps `username` and the role current. */
  async sync(user: { id: string; role: Role; displayName: string; losUserId?: number | null }): Promise<void> {
    await this.repository.sync(user.id, user.role, user.displayName, user.losUserId);
  }

  /**
   * Called when an account is disabled or re-enabled. Requests with an access token issued before that are refused
   * once the identity cache (`IDENTITY_CACHE_MS`) expires.
   */
  async setStatus(user: { id: string; role: Role }, status: "ACTIVE" | "DISABLED") {
    await this.repository.setStatus(user.id, user.role, status);
  }
}
