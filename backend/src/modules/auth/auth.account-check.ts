import { IDENTITY_CACHE_MS } from "@shared/auth/mapped-auth-client.js";
import type { AuthClient, AuthContext } from "@shared/auth/auth.types.js";
import { ForbiddenError, UnauthorizedError } from "@shared/errors/AppError.js";

/** The account fields an access token is checked against. */
export interface AccountLookup {
  account(userId: string): Promise<{ role: string; status: string } | null>;
}

/**
 * Wraps access-token verification so a token is only as good as the account behind it: once the account is disabled
 * (403) or its role changed (401, the client refreshes and, its sessions being revoked, signs in again), older tokens
 * are refused within `ttlMs`, without waiting for them to expire. The account is read at most once per `ttlMs` per user.
 */
export class AccountCheckedAuthClient implements AuthClient {
  private readonly cache = new Map<string, { role: string; status: string; expires: number }>();

  constructor(
    private readonly inner: AuthClient,
    private readonly accounts: AccountLookup,
    private readonly ttlMs: number = IDENTITY_CACHE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async verifyToken(token: string): Promise<AuthContext> {
    const auth = await this.inner.verifyToken(token);
    const account = await this.lookup(auth.userId);
    if (!account) throw new UnauthorizedError("Invalid token");
    if (account.status !== "ACTIVE") throw new ForbiddenError("This account is disabled");
    if (account.role !== auth.role) throw new UnauthorizedError("Access token is out of date; sign in again");
    return auth;
  }

  private async lookup(userId: string) {
    const now = this.now();
    const cached = this.cache.get(userId);
    if (cached && cached.expires > now) return cached;

    const account = await this.accounts.account(userId);
    if (!account) {
      this.cache.delete(userId);
      return null;
    }
    if (this.cache.size > 10_000) {
      for (const [key, entry] of this.cache) if (entry.expires <= now) this.cache.delete(key);
    }
    const entry = { role: account.role, status: account.status, expires: now + this.ttlMs };
    this.cache.set(userId, entry);
    return entry;
  }
}
