import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { logger } from "@config/logger.js";
import { UnauthorizedError } from "@shared/errors/AppError.js";
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
const INVALID = "Invalid LOS token";

/** LOS ids are positive 32-bit integers (MySQL INT). */
const isLosUserId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_INT32;

/** Accepts the LOS staff role in any case (`agent`, `Agent`) when it names one of the chat's staff roles. */
const staffRoleOf = (value: unknown): Role | null => {
  if (typeof value !== "string") return null;
  const role = value.trim().toUpperCase();
  return (STAFF_ROLES as readonly string[]).includes(role) ? (role as Role) : null;
};

/**
 * Checks tokens signed by LOS (RS256 only, with the configured issuer and audience) and reads who they are for. Every
 * failure is the same 401, so a caller learns nothing about which check failed; the reason is logged at debug level.
 */
export class LosTokenVerifier {
  constructor(
    private readonly config: LosConfig,
    private readonly key: LosKey,
  ) {}

  /** The LOS access token of a mobile customer: `type = customer`, `tokenType = access`. */
  async verifyCustomer(token: string): Promise<LosIdentity> {
    const claims = await this.verify(token, this.config.customerAudience);
    if (claims.type !== "customer" || claims.tokenType !== "access") this.reject("not a customer access token");
    return { losUserType: "CUSTOMER", ...this.identity(claims), role: "CUSTOMER" };
  }

  /** The staff hand-off token: `type = staff`, `tokenType` = the configured hand-off type, a known staff `role`. */
  async verifyStaffHandoff(token: string): Promise<LosIdentity> {
    const claims = await this.verify(token, this.config.handoffAudience);
    if (claims.type !== "staff" || claims.tokenType !== this.config.handoffTokenType) {
      this.reject("not a staff hand-off token");
    }
    const role = staffRoleOf(claims.role);
    if (!role) this.reject("unknown staff role");
    return { losUserType: "STAFF", ...this.identity(claims), role };
  }

  private async verify(token: string, audience: string): Promise<JWTPayload & Record<string, unknown>> {
    try {
      const options = { algorithms: ["RS256"], issuer: this.config.issuer, audience };
      const { payload } =
        typeof this.key === "function"
          ? await jwtVerify(token, this.key, options)
          : await jwtVerify(token, this.key, options);
      return payload;
    } catch (error) {
      logger.debug({ err: error }, "LOS token rejected");
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

/** The LOS verifier for the configured key: a JWKS endpoint (keys can rotate) or one PEM public key. */
export async function losVerifierFrom(env: {
  LOS_ISSUER?: string | undefined;
  LOS_JWKS_URL?: string | undefined;
  LOS_PUBLIC_KEY?: string | undefined;
  LOS_CUSTOMER_AUDIENCE: string;
  LOS_HANDOFF_AUDIENCE: string;
  LOS_HANDOFF_TOKEN_TYPE: string;
}): Promise<LosTokenVerifier | null> {
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
    },
    key,
  );
}
