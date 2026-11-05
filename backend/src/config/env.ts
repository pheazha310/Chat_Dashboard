import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  // "dev" accepts `dev:<userId>:<ROLE>` tokens; "external" will verify against Backend 1 (contract pending).
  // "redis" fans events out across API instances; "memory" is for one process (tests, single-instance dev).
  EVENT_BUS: z.enum(["redis", "memory"]).default("redis"),
  // Customer and agent profiles. "dev" returns labelled synthetic data; "external" will call Backend 1 (contract pending).
  BACKEND1_MODE: z.enum(["dev", "external"]).default("dev"),
  AUTH_MODE: z.enum(["dev", "external"]).default("dev"),
});

export const env = schema
  .refine((value) => !(value.NODE_ENV === "production" && value.AUTH_MODE === "dev"), {
    message: "AUTH_MODE=dev is not allowed in production",
    path: ["AUTH_MODE"],
  })
  .refine((value) => !(value.NODE_ENV === "production" && value.BACKEND1_MODE === "dev"), {
    message: "BACKEND1_MODE=dev is not allowed in production",
    path: ["BACKEND1_MODE"],
  })
  .parse(process.env);
