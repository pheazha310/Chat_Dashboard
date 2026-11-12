import "dotenv/config";
import { z } from "zod";

/** A bare web origin (`https://host[:port]`): normalised, so a trailing slash is fine; a path or `*` is refused. */
const origin = () =>
  z
    .string()
    .refine((value) => URL.canParse(value) && new URL(value).origin === new URL(value).href.replace(/\/$/, ""), {
      message: "must be an origin such as https://host (no path, no wildcard)",
    })
    .transform((value) => new URL(value).origin);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  // "redis" fans events out across API instances; "memory" is for one process (tests, single-instance dev).
  EVENT_BUS: z.enum(["redis", "memory"]).default("redis"),
  // Customer and agent profiles. "local" reads the `users` table; "dev" returns labelled synthetic data;
  // "external" is reserved for a Backend 1 loan-data client (contract pending).
  BACKEND1_MODE: z.enum(["dev", "local", "external"]).default("dev"),
  // "jwt" accepts only access tokens issued by this backend; "dev" also accepts `dev:<userId>:<ROLE>` tokens. Defaults
  // to "jwt" so a deployment that forgets NODE_ENV=production still refuses forged `dev:` tokens; opt in locally.
  AUTH_MODE: z.enum(["dev", "jwt"]).default("jwt"),
  // HMAC key for access tokens (HS256), at least 32 characters. Required in production; elsewhere a random key is
  // generated at start-up (tokens then stop working on restart and are not shared between instances).
  JWT_SECRET: z.string().min(32).optional(),
  // Access-token lifetime per audience: the dashboard re-checks often, the mobile app refreshes less.
  STAFF_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  CUSTOMER_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  // How long one sign-in lasts. Fixed at sign-in: refreshing does not extend it.
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // How often the API deletes expired sign-in sessions of every user; 0 turns the job off.
  AUTH_SESSION_CLEANUP_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(60),
  // Sign in with LOS (POST /auth/los). Off unless LOS_ISSUER is set; then LOS_JWKS_URL or LOS_PUBLIC_KEY (PEM, "\n"
  // allowed for newlines) gives the key LOS signs its RS256 tokens with.
  LOS_ISSUER: z.string().min(1).optional(),
  LOS_JWKS_URL: z.url().optional(),
  LOS_PUBLIC_KEY: z.string().min(1).optional(),
  // `aud` of the LOS customer access token the mobile app holds, and of the staff hand-off token LOS issues for chat.
  LOS_CUSTOMER_AUDIENCE: z.string().min(1).default("luyleun"),
  LOS_HANDOFF_AUDIENCE: z.string().min(1).default("chat"),
  // `tokenType` claim of the staff hand-off token.
  LOS_HANDOFF_TOKEN_TYPE: z.string().min(1).default("chat-handoff"),
  // LOS staff role names that differ from the chat's, as "losName:ROLE" pairs, e.g. "loan_officer:AGENT,manager:SUPERVISOR".
  // Names not listed are accepted when they are a chat staff role (agent, supervisor, admin; any case).
  LOS_STAFF_ROLE_MAP: z.string().default(""),
  // The LOS API (Dev https://api-dev.los.delightech.asia/api/v1, Staging https://api-uat.los.delightech.asia/api/v1).
  // Each environment has its own signing key: its JWKS must be on the same host as this URL.
  LOS_BASE_URL: z.url().optional(),
  // Longest life (seconds, `exp` - `iat`) accepted for a staff hand-off token; LOS issues ~120.
  LOS_HANDOFF_TOKEN_MAX_AGE: z.coerce.number().int().min(10).max(600).default(120),
  // Exact origins of LOS Web (parent of the iframe) and of the chat dashboard, for postMessage checks. No wildcard.
  LOS_WEB_ORIGIN: origin().optional(),
  CHAT_WEB_ORIGIN: origin().optional(),
  // PENDING at LOS (machine-to-machine access for /integration/chat/*): not issued yet, nothing reads them yet.
  LOS_SERVICE_API_KEY: z.string().min(1).optional(),
  LOS_SERVICE_ALLOWED_IPS: z.string().default(""),
  // How long a staff session started by an LOS hand-off lasts, fixed at sign-in. After it the dashboard needs a fresh
  // hand-off, so a staff member LOS has suspended, or whose role changed, is picked up (LOS sends no event for that).
  LOS_STAFF_SESSION_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
  // Sign-in, registration and refresh requests per client IP per minute; 0 turns the limit off.
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(20),
  // Express `trust proxy` hop count, so the client IP is read from X-Forwarded-For behind a load balancer. 0 = direct.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  // Uploaded files. "local" keeps them on this server's disk under STORAGE_DIR (one server); "s3" keeps them in an S3
  // bucket, or an S3-compatible store such as MinIO or R2 through S3_ENDPOINT, so several API servers share them.
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().min(1).default("./storage"),
  // Required with STORAGE_DRIVER=s3. Credentials come from the standard AWS chain (AWS_ACCESS_KEY_ID and
  // AWS_SECRET_ACCESS_KEY, a shared profile, or the server's IAM role), never from this file.
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  // Only for S3-compatible stores; MinIO also needs S3_FORCE_PATH_STYLE=true (bucket in the path, not the host name).
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Callbacks (FR-25). The job runs inside the API process; 0 turns it off (tests, or a dedicated worker later).
  CALLBACK_JOB_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(30),
  // How long before the scheduled time the assignee is reminded.
  CALLBACK_REMINDER_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  // How long after the scheduled time a still-pending callback is marked MISSED.
  CALLBACK_MISSED_AFTER_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  // Calls (FR-26). Only signalling goes through this server; media flows between the browsers.
  CALL_RING_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(300).default(45),
  CALL_MAX_MINUTES: z.coerce.number().int().min(1).max(1440).default(240),
  CALL_JOB_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(10),
  // Comma-separated URLs such as "stun:stun.example.com:3478". Empty by default: no third party sees client addresses.
  CALL_STUN_URLS: z.string().default(""),
  CALL_TURN_URLS: z.string().default(""),
  // Shared secret of a coturn `use-auth-secret` server: callers get short-lived credentials derived from it.
  CALL_TURN_SECRET: z.string().optional(),
  CALL_TURN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  // Alternative for a TURN server without a shared secret: one fixed account.
  CALL_TURN_USERNAME: z.string().optional(),
  CALL_TURN_CREDENTIAL: z.string().optional(),
  // Hard cap for one upload; each file type also has its own, lower limit.
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
});

export const env = schema
  .refine((value) => !(value.NODE_ENV === "production" && value.AUTH_MODE === "dev"), {
    message: "AUTH_MODE=dev is not allowed in production",
    path: ["AUTH_MODE"],
  })
  .refine((value) => !(value.NODE_ENV === "production" && !value.JWT_SECRET), {
    message: "JWT_SECRET is required in production",
    path: ["JWT_SECRET"],
  })
  .refine((value) => !value.LOS_ISSUER || Boolean(value.LOS_JWKS_URL ?? value.LOS_PUBLIC_KEY), {
    message: "LOS_ISSUER needs LOS_JWKS_URL or LOS_PUBLIC_KEY",
    path: ["LOS_ISSUER"],
  })
  .refine(
    (value) =>
      !value.LOS_BASE_URL ||
      !value.LOS_JWKS_URL ||
      new URL(value.LOS_BASE_URL).host === new URL(value.LOS_JWKS_URL).host,
    {
      message: "LOS_JWKS_URL and LOS_BASE_URL must be on the same host (Dev and Staging keys differ)",
      path: ["LOS_JWKS_URL"],
    },
  )
  .refine((value) => value.STORAGE_DRIVER !== "s3" || Boolean(value.S3_BUCKET), {
    message: "STORAGE_DRIVER=s3 needs S3_BUCKET",
    path: ["S3_BUCKET"],
  })
  .refine((value) => value.STORAGE_DRIVER !== "s3" || Boolean(value.S3_REGION), {
    message: "STORAGE_DRIVER=s3 needs S3_REGION",
    path: ["S3_REGION"],
  })
  .refine((value) => !(value.NODE_ENV === "production" && value.BACKEND1_MODE === "dev"), {
    message: "BACKEND1_MODE=dev is not allowed in production",
    path: ["BACKEND1_MODE"],
  })
  .parse(process.env);
