import type { IdentityResolver } from "@shared/ports/identity.js";
import type { AuthClient, AuthContext } from "./auth.types.js";

/**
 * How long a resolved identity is reused, so a request does not hit the database. A disabled user is refused, and a
 * change to a role's permissions applies, within this time.
 */
export const IDENTITY_CACHE_MS = 60_000;

/**
 * Wraps the token-verifying `AuthClient`: after the token is verified, the identity is mapped to a chat user (and refused if
 * that user is disabled) and given its role's permissions. Used by REST and the WebSocket gateway, so both resolve the same identity the same way.
 */
export class MappedAuthClient implements AuthClient {
  private readonly cache = new Map<
    string,
    { chatUserId: string; permissions?: ReadonlySet<string>; expires: number }
  >();

  constructor(
    private readonly inner: AuthClient,
    private readonly identities: IdentityResolver,
    private readonly now: () => number = Date.now,
  ) {}

  async verifyToken(token: string): Promise<AuthContext> {
    const auth = await this.inner.verifyToken(token);
    const key = `${auth.role}:${auth.userId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return withIdentity(auth, cached);

    const { chatUserId, permissions } = await this.identities.resolve(auth);
    const entry = { chatUserId, ...(permissions ? { permissions } : {}), expires: this.now() + IDENTITY_CACHE_MS };
    this.cache.set(key, entry);
    return withIdentity(auth, entry);
  }
}

const withIdentity = (
  auth: AuthContext,
  entry: { chatUserId: string; permissions?: ReadonlySet<string> },
): AuthContext => ({
  ...auth,
  chatUserId: entry.chatUserId,
  ...(entry.permissions ? { permissions: entry.permissions } : {}),
});
