import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, errors as joseErrors, jwtVerify } from "jose";
import { UnauthorizedError } from "@shared/errors/AppError.js";
import { ROLES, type AuthClient, type AuthContext, type Role } from "@shared/auth/auth.types.js";

const ISSUER = "chat-dashboard";
const AUDIENCE = "chat-dashboard";
const ALGORITHM = "HS256";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Access-token lifetime in seconds: one for everyone, or one for staff and one for customers. */
export type AccessTokenTtl = number | { staff: number; customer: number };

/**
 * Short-lived access tokens: HS256 JWTs carrying `sub` (users.id) and `role`. They are not stored; a revoked session
 * stops being refreshed, and its last access token expires within the TTL of its audience.
 */
export class AccessTokens implements AuthClient {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttl: AccessTokenTtl,
  ) {
    if (secret.length < 32) throw new Error("The access-token secret must be at least 32 characters");
    this.key = new TextEncoder().encode(secret);
  }

  async issue(user: { id: string; role: string }): Promise<{ token: string; expiresAt: Date }> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + this.ttlFor(user.role);
    const token = await new SignJWT({ role: user.role, typ: "access" })
      .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setJti(randomUUID())
      .sign(this.key);
    return { token, expiresAt: new Date(expiresAt * 1000) };
  }

  /** Seconds an access token of this role lives: customers get the mobile TTL, every staff role the dashboard's. */
  ttlFor(role: string): number {
    if (typeof this.ttl === "number") return this.ttl;
    return role === "CUSTOMER" ? this.ttl.customer : this.ttl.staff;
  }

  /** `AuthClient`: any problem (bad signature, expired, wrong issuer, unknown role) is the same 401. */
  async verifyToken(token: string): Promise<AuthContext> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: [ALGORITHM],
      });
      const role = payload.role as Role;
      if (payload.typ !== "access" || typeof payload.sub !== "string" || !UUID.test(payload.sub)) throw new Error();
      if (!ROLES.includes(role)) throw new Error();
      return { userId: payload.sub, role };
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) throw new UnauthorizedError("Access token expired");
      throw new UnauthorizedError("Invalid token");
    }
  }
}

/** A new opaque refresh token (256 random bits). Only its hash is ever stored. */
export const newRefreshToken = () => randomBytes(32).toString("base64url");

export const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Development/test: accepts `dev:<uuid>:<ROLE>` tokens as well as real access tokens. Never used in production
 * (env.ts refuses AUTH_MODE=dev there).
 */
export class DevOrJwtAuthClient implements AuthClient {
  constructor(
    private readonly dev: AuthClient,
    private readonly jwt: AuthClient,
  ) {}

  verifyToken(token: string) {
    return token.startsWith("dev:") ? this.dev.verifyToken(token) : this.jwt.verifyToken(token);
  }
}
