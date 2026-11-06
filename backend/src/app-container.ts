import { env } from "@config/env.js";
import { redis } from "@config/redis.js";
import { LocalStorage } from "@shared/storage/local-storage.js";
import { createDirectory } from "@shared/directory/directory.js";
import { createContainer } from "./container.js";
import { MemoryEventBus, RedisEventBus } from "./websocket/websocket.bus.js";

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
);
