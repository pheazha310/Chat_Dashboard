import { randomUUID } from "node:crypto";
import { logger } from "@config/logger.js";
import type { AuthContext, Role } from "@shared/auth/auth.types.js";
import { AppError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "@shared/errors/AppError.js";
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from "./auth.password.js";
import { isUniqueViolation, type AuthRepository } from "./auth.repository.js";
import type { LosTokenVerifier } from "./auth.los.js";
import type { ChangePasswordInput, LoginInput, RegisterInput } from "./auth.schema.js";
import { hashRefreshToken, newRefreshToken, type AccessTokens } from "./auth.tokens.js";
import {
  DEFAULT_AUTH_OPTIONS,
  fitsAudience,
  toUser,
  type Audience,
  type AuthOptions,
  type AuthTokensDto,
  type ClientInfo,
  type UserDto,
  type UserRow,
} from "./auth.types.js";

/** Copies the account's name and role to its chat identity (ChatIdentityService). */
export interface IdentitySync {
  sync(user: { id: string; role: Role; displayName: string; losUserId?: number | null }): Promise<void>;
}

/** The refresh being rotated: the new session joins its sign-in and keeps its end. */
interface Rotation {
  familyId: string;
  replaces: string;
  expiresAt: Date;
}

const INVALID_LOGIN = "Invalid email or password";
const INVALID_REFRESH = "Invalid or expired refresh token";
const NO_PASSWORD = "This account signs in with LOS and has no password";

/** 429 while an account is locked after too many failed sign-ins. */
export class AccountLockedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, "ACCOUNT_LOCKED", "Too many failed sign-in attempts; try again later", { retryAfterSeconds });
  }
}

/**
 * Sign-in, registration and sessions. This backend owns authentication: it stores scrypt password hashes, issues
 * short-lived JWT access tokens and long-lived opaque refresh tokens (stored hashed, rotated on every use, and the
 * whole sign-in revoked if an already-used token is presented again). Staff and customers sign in at separate
 * endpoints (`audience`); an account of the other kind is refused there with the same message as a wrong password.
 */
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly tokens: AccessTokens,
    private readonly options: AuthOptions = DEFAULT_AUTH_OPTIONS,
    private readonly now: () => Date = () => new Date(),
    private readonly identities: IdentitySync = { sync: async () => {} },
    /** Sign in with LOS; null when LOS is not configured (LOS_ISSUER unset). */
    private readonly los: LosTokenVerifier | null = null,
  ) {}

  /** Mobile self-registration. Always creates a CUSTOMER; staff accounts are created by an admin. */
  async register(input: RegisterInput, client: ClientInfo): Promise<AuthTokensDto> {
    let user: UserRow;
    try {
      user = await this.repository.createUser({
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role: "CUSTOMER",
        displayName: input.displayName,
        createdBy: null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError("An account with this email already exists");
      throw error;
    }
    await this.syncIdentity(user);
    return this.startSession(user, client);
  }

  async login(audience: Audience, input: LoginInput, client: ClientInfo): Promise<AuthTokensDto> {
    const user = await this.repository.findUserByEmail(input.email);
    if (!user) {
      await burnPasswordCheck(input.password);
      throw new UnauthorizedError(INVALID_LOGIN);
    }
    const now = this.now();
    if (!(await this.checkPassword(user, input.password, now))) throw new UnauthorizedError(INVALID_LOGIN);
    // The password was right, so saying why is safe from here on, except for the endpoint mismatch.
    if (!fitsAudience(audience, user.role)) throw new UnauthorizedError(INVALID_LOGIN);
    if (user.status !== "ACTIVE") throw new ForbiddenError("This account is disabled");

    await this.repository.recordSuccessfulLogin(user.id);
    await this.syncIdentity(user);
    if (user.passwordHash && needsRehash(user.passwordHash)) {
      await this.repository.setPassword(user.id, await hashPassword(input.password));
    }
    return this.startSession({ ...user, lastLoginAt: now }, client);
  }

  /**
   * Sign in with LOS: the mobile app sends the LOS customer access token it holds, the dashboard a short-lived LOS staff
   * hand-off token. The token proves who the caller is; the account is found by its LOS id or created (no email, no
   * password), and from then on the caller uses this backend's tokens only. For staff the role comes from LOS on every
   * sign-in; a changed role signs the account out of its other devices, as an admin role change does.
   */
  async losSignIn(audience: Audience, token: string, client: ClientInfo): Promise<AuthTokensDto> {
    if (!this.los) throw new AppError(503, "LOS_SIGN_IN_DISABLED", "Sign in with LOS is not configured");
    const los =
      audience === "customer" ? await this.los.verifyCustomer(token) : await this.los.verifyStaffHandoff(token);

    let user = await this.repository.findUserByLos(los.losUserType, los.losUserId);
    if (!user) {
      try {
        user = await this.repository.createLosUser({
          losUserType: los.losUserType,
          losUserId: los.losUserId,
          role: los.role,
          displayName: los.username,
        });
      } catch (error) {
        // Two first sign-ins at once: the other one created the account.
        if (!isUniqueViolation(error)) throw error;
        user = await this.repository.findUserByLos(los.losUserType, los.losUserId);
        if (!user) throw error;
      }
    }
    if (user.status !== "ACTIVE") throw new ForbiddenError("This account is disabled");

    const roleChanged = user.role !== los.role;
    if (roleChanged || user.displayName !== los.username) {
      user = await this.repository.updateUser(user.id, { role: los.role, displayName: los.username });
      if (roleChanged) await this.repository.revokeAllForUser(user.id);
    }
    await this.repository.recordSuccessfulLogin(user.id);
    await this.syncIdentity(user);
    return this.startSession({ ...user, lastLoginAt: this.now() }, client);
  }

  /**
   * Exchanges a refresh token for a new pair. The presented token is revoked; presenting it again later (a stolen
   * copy, or a client that lost the newer one) revokes every token of that sign-in, and the user signs in again.
   */
  async refresh(audience: Audience, refreshToken: string, client: ClientInfo): Promise<AuthTokensDto> {
    const session = await this.repository.findSessionByHash(hashRefreshToken(refreshToken));
    if (!session) throw new UnauthorizedError(INVALID_REFRESH);
    if (session.revokedAt) {
      await this.repository.revokeFamily(session.familyId);
      logger.warn({ userId: session.userId, familyId: session.familyId }, "revoked refresh token reused");
      throw new UnauthorizedError(INVALID_REFRESH);
    }
    const { user } = session;
    if (session.expiresAt <= this.now() || user.status !== "ACTIVE" || !fitsAudience(audience, user.role)) {
      throw new UnauthorizedError(INVALID_REFRESH);
    }
    const rotated = await this.repository.inTransaction(async (tx) =>
      // Two requests with the same token: one rotates it, the other is treated as reuse.
      (await tx.revokeIfActive(session.id))
        ? this.startSession(user, client, tx, {
            familyId: session.familyId,
            replaces: session.id,
            expiresAt: session.expiresAt,
          })
        : null,
    );
    if (!rotated) {
      // Outside the transaction above, so throwing does not roll the revocation back.
      await this.repository.revokeFamily(session.familyId);
      throw new UnauthorizedError(INVALID_REFRESH);
    }
    return rotated;
  }

  /** Ends one sign-in (the refresh token's whole family). Unknown or already revoked tokens are accepted silently. */
  async logout(refreshToken: string): Promise<void> {
    const session = await this.repository.findSessionByHash(hashRefreshToken(refreshToken));
    if (session) await this.repository.revokeFamily(session.familyId);
  }

  /** Signs the caller out everywhere. Access tokens already issued stay valid until they expire. */
  async logoutAll(auth: AuthContext): Promise<void> {
    await this.repository.revokeAllForUser(auth.userId);
  }

  async me(auth: AuthContext): Promise<UserDto> {
    const user = await this.repository.findUserById(auth.userId);
    if (!user) throw new NotFoundError("Account not found");
    return toUser(user);
  }

  /** Changes the caller's password, signs out every other device and returns a fresh sign-in for this one. */
  async changePassword(auth: AuthContext, input: ChangePasswordInput, client: ClientInfo): Promise<AuthTokensDto> {
    const user = await this.repository.findUserById(auth.userId);
    if (!user) throw new NotFoundError("Account not found");
    if (!user.passwordHash) throw new ConflictError(NO_PASSWORD);
    // Counts toward the sign-in lock, so a stolen access token cannot be used to guess the password.
    if (!(await this.checkPassword(user, input.currentPassword, this.now()))) {
      throw new ForbiddenError("The current password is wrong");
    }
    const passwordHash = await hashPassword(input.newPassword);
    return this.repository.inTransaction(async (tx) => {
      await tx.setPassword(user.id, passwordHash);
      await tx.revokeAllForUser(user.id);
      return this.startSession(user, client, tx);
    });
  }

  /**
   * Refuses a locked account (429) without checking the password; otherwise checks it and records a failure, locking
   * the account after `maxFailedLogins` in a row.
   */
  private async checkPassword(user: UserRow, password: string, now: Date): Promise<boolean> {
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new AccountLockedError(Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000));
    }
    if (user.passwordHash === null) {
      await burnPasswordCheck(password);
      return false;
    }
    if (await verifyPassword(password, user.passwordHash)) return true;
    await this.repository.recordFailedLogin(
      user.id,
      this.options.maxFailedLogins,
      new Date(now.getTime() + this.options.lockMs),
    );
    return false;
  }

  /** Keeps `chat_users.username` and its role in step with the account ("refreshed on sign-in"). Best effort. */
  private async syncIdentity(user: UserRow) {
    try {
      await this.identities.sync({
        id: user.id,
        role: user.role as Role,
        displayName: user.displayName,
        losUserId: user.losUserId,
      });
    } catch (error) {
      logger.error({ err: error, userId: user.id }, "could not sync the account to chat_users");
    }
  }

  /**
   * Issues a token pair. Without `rotation` this is a new sign-in: a new family that lasts `refreshTtlMs`, and the
   * user's expired sessions are deleted. With it, the new session continues that sign-in and keeps its end, so
   * refreshing never makes a sign-in last longer than `refreshTtlMs`.
   */
  private async startSession(
    user: UserRow,
    client: ClientInfo,
    repository: AuthRepository = this.repository,
    rotation?: Rotation,
  ): Promise<AuthTokensDto> {
    const now = this.now();
    if (!rotation) await repository.deleteExpiredSessions(user.id, now);
    const refreshToken = newRefreshToken();
    const refreshExpiresAt = rotation?.expiresAt ?? new Date(now.getTime() + this.options.refreshTtlMs);
    const created = await repository.createSession({
      userId: user.id,
      familyId: rotation?.familyId ?? randomUUID(),
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshExpiresAt,
      userAgent: client.userAgent?.slice(0, 255) ?? null,
      ipAddress: client.ipAddress?.slice(0, 45) ?? null,
    });
    if (rotation) await repository.markReplaced(rotation.replaces, created.id);
    const access = await this.tokens.issue(user);
    return {
      tokenType: "Bearer",
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      user: toUser(user),
    };
  }
}
