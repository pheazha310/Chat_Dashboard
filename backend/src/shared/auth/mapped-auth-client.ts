import type { IdentityResolver } from "@shared/ports/identity.js";
import type { AuthClient, AuthContext } from "./auth.types.js";

/** How long a resolved identity is reused, so a request does not hit the database. A disabled user is refused within this time. */
export const IDENTITY_CACHE_MS = 60_000;

/**
 * Wraps the Backend 1 `AuthClient`: after the token is verified, the identity is mapped to a chat user (and refused if
 * that user is disabled). Used by REST and the WebSocket gateway, so both resolve the same identity the same way.
 */
export class MappedAuthClient implements AuthClient {
  private readonly cache = new Map<string, { chatUserId: string; expires: number }>();

  constructor(
    private readonly inner: AuthClient,
    private readonly identities: IdentityResolver,
    private readonly now: () => number = Date.now,
  ) {}

  async verifyToken(token: string): Promise<AuthContext> {
    const auth = await this.inner.verifyToken(token);
    const key = `${auth.role}:${auth.userId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return { ...auth, chatUserId: cached.chatUserId };

    const { chatUserId } = await this.identities.resolve(auth);
    this.cache.set(key, { chatUserId, expires: this.now() + IDENTITY_CACHE_MS });
    return { ...auth, chatUserId };
  }
}
