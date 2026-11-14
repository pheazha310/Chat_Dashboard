import { randomBytes } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@config/env.js";
import { logger } from "@config/logger.js";
import { redis } from "@config/redis.js";
import { LocalStorage } from "@shared/storage/local-storage.js";
import { S3Storage } from "@shared/storage/s3-storage.js";
import type { Storage } from "@shared/storage/storage.js";
import { DevAuthClient } from "@shared/auth/dev-auth-client.js";
import { MappedAuthClient } from "@shared/auth/mapped-auth-client.js";
import { MemoryRateLimitStore, RedisRateLimitStore } from "@shared/middleware/rate-limit.middleware.js";
import { AccountCheckedAuthClient } from "@modules/auth/auth.account-check.js";
import { AuthRepository } from "@modules/auth/auth.repository.js";
import { AuthAuditRepository } from "@modules/auth/auth.audit.repository.js";
import { AuthService } from "@modules/auth/auth.service.js";
import { losVerifierFrom } from "@modules/auth/auth.los.js";
import { LosStaffLogin } from "@modules/auth/auth.los-login.js";
import { BearerTokenAuth, LosDataClient } from "@modules/los-data/los-data.client.js";
import { LoanApplicationRepository } from "@modules/los-data/los-data.repository.js";
import { LoanApplicationService } from "@modules/los-data/los-data.service.js";
import { PrismaUsedTokenIds } from "@modules/auth/auth.used-token.repository.js";
import { AccessTokens, DevOrJwtAuthClient } from "@modules/auth/auth.tokens.js";
import { DEFAULT_AUTH_OPTIONS } from "@modules/auth/auth.types.js";
import { UserDirectory, UserService } from "@modules/auth/user.service.js";
import { ChatIdentityRepository, ChatIdentityService } from "@modules/chat-identity/index.js";
import { RoleRepository } from "@modules/roles/role.repository.js";
import { RoleService } from "@modules/roles/role.service.js";
import { createDirectory } from "@shared/directory/directory.js";
import { createContainer } from "./container.js";
import { MemoryEventBus, RedisEventBus } from "./websocket/websocket.bus.js";

const csv = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** Where uploaded files live (STORAGE_DRIVER). env.ts refuses to start "s3" without S3_BUCKET and S3_REGION. */
const storage: Storage =
  env.STORAGE_DRIVER === "s3"
    ? new S3Storage(
        new S3Client({
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
          ...(env.S3_ACCESS_KEY && env.S3_SECRET_KEY
            ? { credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } }
            : {}),
        }),
        env.S3_BUCKET as string,
      )
    : new LocalStorage(env.STORAGE_DIR);

const identities = new ChatIdentityService(new ChatIdentityRepository());
const authRepository = new AuthRepository();

function accessTokenSecret(): string {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  // Only outside production (env.ts requires JWT_SECRET there).
  logger.warn("JWT_SECRET is not set: using a random key, so access tokens stop working when the server restarts");
  return randomBytes(48).toString("base64url");
}

/** Issues and verifies access tokens (JWT). */
const accessTokens = new AccessTokens(accessTokenSecret(), {
  staff: env.STAFF_ACCESS_TOKEN_TTL_SECONDS,
  customer: env.CUSTOMER_ACCESS_TOKEN_TTL_SECONDS,
});

/** Checks LOS tokens for "sign in with LOS"; null (the endpoints answer 503) when LOS_ISSUER is not set. */
const losVerifier = await losVerifierFrom(env, new PrismaUsedTokenIds());

/** Authentication events (`auth_audit_events`). */
const authAudit = new AuthAuditRepository();

/** Sign-in, registration, refresh and password changes. */
export const authService = new AuthService(
  authRepository,
  accessTokens,
  {
    ...DEFAULT_AUTH_OPTIONS,
    refreshTtlMs: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    losStaffSessionMs: env.LOS_STAFF_SESSION_SECONDS * 1000,
  },
  undefined,
  identities,
  losVerifier,
  // `loanApplications` is built below, once the conversation access it needs exists.
  { refreshFromCustomerToken: (customerId, token) => loanApplications.refreshFromCustomerToken(customerId, token) },
  // Staff sign in with their LOS username and password (tried before the chat accounts); needs LOS_BASE_URL.
  env.LOS_BASE_URL ? new LosStaffLogin(env.LOS_BASE_URL) : null,
  authAudit,
);

/** Account management (admins), and the `local` directory of names. */
export const userService = new UserService(authRepository, identities, authAudit);

/** What each role may do (roles, permissions). */
export const roleService = new RoleService(new RoleRepository());

/** Counters for the sign-in rate limit: Redis when several instances share it, in-memory for a single process. */
export const rateLimitStore = env.EVENT_BUS === "redis" ? new RedisRateLimitStore(redis) : new MemoryRateLimitStore();

/** The running application's services, shared by the REST routes and the WebSocket gateway. */
export const container = createContainer(
  env.EVENT_BUS === "redis" ? new RedisEventBus(env.REDIS_URL) : new MemoryEventBus(),
  redis,
  createDirectory(() => new UserDirectory(userService)),
  storage,
  {
    reminderLeadMs: env.CALLBACK_REMINDER_MINUTES * 60_000,
    missedAfterMs: env.CALLBACK_MISSED_AFTER_MINUTES * 60_000,
  },
  {
    options: { ringTimeoutMs: env.CALL_RING_TIMEOUT_SECONDS * 1000, maxDurationMs: env.CALL_MAX_MINUTES * 60_000 },
    ice: {
      stunUrls: csv(env.CALL_STUN_URLS),
      turnUrls: csv(env.CALL_TURN_URLS),
      turnSecret: env.CALL_TURN_SECRET,
      turnTtlSeconds: env.CALL_TURN_TTL_SECONDS,
      turnUsername: env.CALL_TURN_USERNAME,
      turnCredential: env.CALL_TURN_CREDENTIAL,
    },
  },
);

/**
 * Verifies access tokens against the current account (disabled or role changed: refused within a minute) and, with
 * AUTH_MODE=dev, `dev:` tokens; then maps the identity to a chat user and refuses disabled chat accounts. Shared by REST and the WebSocket gateway.
 */
const checkedAccessTokens = new AccountCheckedAuthClient(accessTokens, userService);
export const authClient = new MappedAuthClient(
  env.AUTH_MODE === "dev" ? new DevOrJwtAuthClient(new DevAuthClient(), checkedAccessTokens) : checkedAccessTokens,
  identities,
);

/**
 * Loan data for the agent panel: read with the customer's own LOS token at their sign-in (no LOS service credential
 * exists yet). Off while LOS_BASE_URL is unset.
 */
export const loanApplications = new LoanApplicationService(
  new LoanApplicationRepository(),
  container.conversations,
  (token) =>
    env.LOS_BASE_URL ? new LosDataClient({ baseUrl: env.LOS_BASE_URL, auth: new BearerTokenAuth(token) }) : null,
);
