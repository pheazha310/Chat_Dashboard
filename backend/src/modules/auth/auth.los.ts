import {
  createRemoteJWKSet,
  errors as joseErrors,
  importSPKI,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { logger } from "@config/logger.js";
import { AppError, UnauthorizedError } from "@shared/errors/AppError.js";
import type { Role } from "@shared/auth/auth.types.js";
import { STAFF_ROLES } from "./auth.types.js";

/** How LOS signs the tokens it hands out (docs/api-auth.md, "Sign in with LOS"). */
export interface LosConfig {
  issuer: string;
  /** `aud` of the customer access token the mobile app already holds. */
  customerAudience: string;
  /** `aud` of the short-lived staff hand-off token LOS issues for the chat dashboard. */
  handoffAudience: string;
  /** `tokenType` claim of that hand-off token. */
  handoffTokenType: string;
  /**
   * `aud` of the LOS staff access token this backend receives itself when it logs a staff member in to LOS with their
   * username and password (see `verifyStaffAccess`). Unset: that sign-in is off.
   */
  staffAccessAudience?: string;
  /** Longest life in seconds (`exp` - `iat`) accepted for a hand-off token; a longer-lived one is refused. */
  handoffMaxAgeSeconds?: number;
  /** LOS staff role names (lower-case) that map to a different chat role, e.g. `loan_officer` → AGENT. */
  staffRoleMap?: ReadonlyMap<string, Role>;
}

/** Who an LOS token says the caller is. LOS numbers customers and staff separately. */
export interface LosIdentity {
  losUserType: "CUSTOMER" | "STAFF";
  losUserId: number;
  username: string;
  /** The chat role: always CUSTOMER for customers, the token's `role` claim for staff. */
  role: Role;
}

type LosKey = JWTVerifyGetKey | CryptoKey;

const MAX_INT32 = 2 ** 31 - 1;
/** Seconds of clock difference between LOS and this server accepted on `exp`/`nbf` (hand-off tokens live ~2 min). */
const CLOCK_TOLERANCE_SECONDS = 30;
const INVALID = "Invalid LOS token";

/** LOS ids are positive 32-bit integers (MySQL INT). */
const isLosUserId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_INT32;

const isStaffRole = (value: string): value is Role => (STAFF_ROLES as readonly string[]).includes(value);

/**
 * The chat role for an LOS staff role: a mapped LOS name (`loan_officer` → AGENT), else the name itself when it is
 * `agent` or `supervisor` in any case. ADMIN is only ever granted through LOS_STAFF_ROLE_MAP: an LOS role that happens
 * to be called "admin" may mean something else in LOS. Anything else is refused.
 */
const staffRoleOf = (value: unknown, map: ReadonlyMap<string, Role>): Role | null => {
  if (typeof value !== "string") return null;
  const name = value.trim();
  // A Map, not an object: a claim such as "constructor" or "__proto__" must not find a built-in property.
  const mapped = map.get(name.toLowerCase());
  if (mapped) return mapped;
  const role = name.toUpperCase();
  return isStaffRole(role) && role !== "ADMIN" ? role : null;
};

/**
 * Reads LOS_STAFF_ROLE_MAP: comma-separated `losName:ROLE` pairs, e.g. `loan_officer:AGENT, manager:SUPERVISOR`.
 * Throws at start-up on a malformed pair or a target that is not a staff role, so a typo cannot silently refuse staff.
 */
export function parseStaffRoleMap(value: string): Map<string, Role> {
  const map = new Map<string, Role>();
  for (const pair of value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const [name, role, ...rest] = pair.split(":").map((part) => part.trim());
    if (!name || !role || rest.length > 0) throw new Error(`LOS_STAFF_ROLE_MAP: "${pair}" is not "losName:ROLE"`);
    const target = role.toUpperCase();
    if (!isStaffRole(target)) {
      throw new Error(`LOS_STAFF_ROLE_MAP: "${role}" is not a staff role (${STAFF_ROLES.join(", ")})`);
    }
    map.set(name.toLowerCase(), target);
  }
  return map;
}

/**
 * The `jti` of staff hand-off tokens already used, so each one signs in once. `claim` records an id until `ttlMs` has
 * passed (when the token has expired anyway) and answers false if it was already recorded.
 */
export interface UsedTokenIds {
  claim(id: string, ttlMs: number): Promise<boolean>;
}

/** One process only (tests). Production uses PrismaUsedTokenIds. */
export class MemoryUsedTokenIds implements UsedTokenIds {
  private readonly ids = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async claim(id: string, ttlMs: number): Promise<boolean> {
    const now = this.now();
    const until = this.ids.get(id);
    if (until !== undefined && until > now) return false;
    if (this.ids.size > 10_000) {
      for (const [key, expires] of this.ids) if (expires <= now) this.ids.delete(key);
    }
    this.ids.set(id, now + ttlMs);
    return true;
  }
}

/**
 * Checks tokens signed by LOS (RS256 only, with the configured issuer and audience) and reads who they are for. Every
 * failure is the same 401, so a caller learns nothing about which check failed; the reason is logged at debug level.
 */
export class LosTokenVerifier {
  constructor(
    private readonly config: LosConfig,
    private readonly key: LosKey,
    private readonly usedIds: UsedTokenIds = new MemoryUsedTokenIds(),
  ) {}

  /** The LOS access token of a mobile customer: `type = customer`, `tokenType = access`. */
  async verifyCustomer(token: string): Promise<LosIdentity> {
    const claims = await this.verify(token, this.config.customerAudience);
    if (claims.type !== "customer" || claims.tokenType !== "access") this.reject("not a customer access token");
    return { losUserType: "CUSTOMER", ...this.identity(claims), role: "CUSTOMER" };
  }

  /**
   * The staff hand-off token: `type = staff`, `tokenType` = the configured hand-off type, a known staff `role` and a
   * `jti`. It signs in once: the same `jti` again is refused, so a leaked hand-off token cannot be replayed.
   */
  async verifyStaffHandoff(token: string): Promise<LosIdentity> {
    const claims = await this.verify(token, this.config.handoffAudience);
    if (claims.type !== "staff" || claims.tokenType !== this.config.handoffTokenType) {
      this.reject("not a staff hand-off token");
    }
    const role = staffRoleOf(claims.role, this.config.staffRoleMap ?? new Map());
    if (!role) this.reject("unknown staff role");
    const maxAge = this.config.handoffMaxAgeSeconds;
    // `iat` is required here: without it the token's lifetime cannot be checked.
    if (maxAge !== undefined && (typeof claims.iat !== "number" || (claims.exp ?? 0) - claims.iat > maxAge)) {
      this.reject("hand-off token lives too long");
    }
    const identity = this.identity(claims);
    await this.claimOnce(claims);
    return { losUserType: "STAFF", ...identity, role };
  }

  /**
   * The LOS staff access token this backend was handed directly by LOS's login (`type = staff`, `tokenType = access`, a
   * known staff `role`). Unlike the hand-off token it is never given to a browser, so it needs no `jti`, one-use rule or
   * short life: it only proves what LOS just said about the credentials this server forwarded.
   */
  async verifyStaffAccess(token: string): Promise<LosIdentity> {
    const audience = this.config.staffAccessAudience;
    if (!audience) this.reject("staff access tokens are not accepted");
    const claims = await this.verify(token, audience);
    if (claims.type !== "staff" || claims.tokenType !== "access") this.reject("not a staff access token");
    const role = staffRoleOf(claims.role, this.config.staffRoleMap ?? new Map());
    if (!role) this.reject("unknown staff role");
    return { losUserType: "STAFF", ...this.identity(claims), role };
  }

  /** Records the hand-off token's `jti` until the token expires; refuses one already used. */
  private async claimOnce(claims: JWTPayload) {
    const { jti, exp } = claims;
    if (typeof jti !== "string" || jti === "" || jti.length > 200) this.reject("missing jti");
    // `exp` is required by verify(); keep the id for as long as the token would still be accepted.
    const ttlMs = ((exp ?? 0) + CLOCK_TOLERANCE_SECONDS) * 1000 - Date.now();
    let fresh: boolean;
    try {
      fresh = await this.usedIds.claim(jti, ttlMs);
    } catch (error) {
      // Refuse rather than allow: without the store a replayed hand-off token could not be told apart.
      logger.warn({ err: error }, "could not record the LOS hand-off token id");
      throw new AppError(503, "LOS_SIGN_IN_UNAVAILABLE", "Sign in with LOS is unavailable; try again later");
    }
    if (!fresh) this.reject("hand-off token already used");
  }

  private async verify(token: string, audience: string): Promise<JWTPayload & Record<string, unknown>> {
    try {
      const options = {
        algorithms: ["RS256"],
        issuer: this.config.issuer,
        audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        // A token without `exp` would never expire.
        requiredClaims: ["exp"],
      };
      const { payload } =
        typeof this.key === "function"
          ? await jwtVerify(token, this.key, options)
          : await jwtVerify(token, this.key, options);
      return payload;
    } catch (error) {
      if (isKeyProblem(error)) {
        // Not the caller's fault: every LOS sign-in fails until the LOS keys can be loaded again.
        logger.warn({ err: error }, "could not load the LOS signing keys");
      } else {
        logger.debug({ err: error }, "LOS token rejected");
      }
      throw new UnauthorizedError(INVALID);
    }
  }

  private identity(claims: Record<string, unknown>) {
    const { userId, username } = claims;
    if (!isLosUserId(userId) || typeof username !== "string" || username.trim() === "") {
      this.reject("missing userId or username");
    }
    return { losUserId: userId, username: username.trim().slice(0, 100) };
  }

  private reject(reason: string): never {
    logger.debug({ reason }, "LOS token rejected");
    throw new UnauthorizedError(INVALID);
  }
}

/** The JWKS endpoint was unreachable, slow or returned garbage (a token that is merely wrong is not a key problem). */
const isKeyProblem = (error: unknown) =>
  error instanceof joseErrors.JWKSTimeout ||
  error instanceof joseErrors.JWKSInvalid ||
  !(error instanceof joseErrors.JOSEError);

/**
 * The LOS verifier for the configured key: a JWKS endpoint (keys can rotate) or one PEM public key. `usedIds` records
 * used hand-off tokens (Redis when several instances run).
 */
export async function losVerifierFrom(
  env: {
    LOS_ISSUER?: string | undefined;
    LOS_JWKS_URL?: string | undefined;
    LOS_PUBLIC_KEY?: string | undefined;
    LOS_CUSTOMER_AUDIENCE: string;
    LOS_HANDOFF_AUDIENCE: string;
    LOS_HANDOFF_TOKEN_TYPE: string;
    LOS_STAFF_ACCESS_AUDIENCE?: string | undefined;
    LOS_HANDOFF_TOKEN_MAX_AGE?: number | undefined;
    LOS_STAFF_ROLE_MAP?: string | undefined;
  },
  usedIds: UsedTokenIds = new MemoryUsedTokenIds(),
): Promise<LosTokenVerifier | null> {
  if (!env.LOS_ISSUER) return null;
  const key: LosKey = env.LOS_JWKS_URL
    ? createRemoteJWKSet(new URL(env.LOS_JWKS_URL))
    : await importSPKI((env.LOS_PUBLIC_KEY ?? "").replace(/\\n/g, "\n"), "RS256");
  return new LosTokenVerifier(
    {
      issuer: env.LOS_ISSUER,
      customerAudience: env.LOS_CUSTOMER_AUDIENCE,
      handoffAudience: env.LOS_HANDOFF_AUDIENCE,
      handoffTokenType: env.LOS_HANDOFF_TOKEN_TYPE,
      ...(env.LOS_STAFF_ACCESS_AUDIENCE !== undefined && { staffAccessAudience: env.LOS_STAFF_ACCESS_AUDIENCE }),
      ...(env.LOS_HANDOFF_TOKEN_MAX_AGE !== undefined && { handoffMaxAgeSeconds: env.LOS_HANDOFF_TOKEN_MAX_AGE }),
      staffRoleMap: parseStaffRoleMap(env.LOS_STAFF_ROLE_MAP ?? ""),
    },
    key,
    usedIds,
  );
}
