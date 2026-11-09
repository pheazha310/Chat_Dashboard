import "dotenv/config";
import { z } from "zod";

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
  // "jwt" accepts only access tokens issued by this backend; "dev" also accepts `dev:<userId>:<ROLE>` tokens.
  AUTH_MODE: z.enum(["dev", "jwt"]).default("dev"),
  // HMAC key for access tokens (HS256), at least 32 characters. Required in production; elsewhere a random key is
  // generated at start-up (tokens then stop working on restart and are not shared between instances).
  JWT_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // Sign-in, registration and refresh requests per client IP per minute; 0 turns the limit off.
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(20),
  // Express `trust proxy` hop count, so the client IP is read from X-Forwarded-For behind a load balancer. 0 = direct.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  // Uploaded files. "local" keeps them on this server's disk under STORAGE_DIR (object storage can be added as a driver).
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_DIR: z.string().min(1).default("./storage"),
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
  .refine((value) => !(value.NODE_ENV === "production" && value.BACKEND1_MODE === "dev"), {
    message: "BACKEND1_MODE=dev is not allowed in production",
    path: ["BACKEND1_MODE"],
  })
  .parse(process.env);
