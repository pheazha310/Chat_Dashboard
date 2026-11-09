import { env } from "@config/env.js";
import { redis } from "@config/redis.js";
import { LocalStorage } from "@shared/storage/local-storage.js";
import { createDirectory } from "@shared/directory/directory.js";
import { createContainer } from "./container.js";
import { MemoryEventBus, RedisEventBus } from "./websocket/websocket.bus.js";

const csv = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** The running application's services, shared by the REST routes and the WebSocket gateway. */
export const container = createContainer(
  env.EVENT_BUS === "redis" ? new RedisEventBus(env.REDIS_URL) : new MemoryEventBus(),
  redis,
  createDirectory(),
  new LocalStorage(env.STORAGE_DIR),
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
