import { createServer } from "node:http";
import { app } from "./app.js";
import { prisma } from "@config/database.js";
import { env } from "@config/env.js";
import { logger } from "@config/logger.js";
import { redis } from "@config/redis.js";
import { authClient } from "@shared/auth/auth.js";
import { container } from "./app-container.js";
import { CallbackScheduler } from "@modules/callbacks/callback.scheduler.js";
import { attachWebSocketServer } from "./websocket/websocket.server.js";

const server = createServer(app);
const wss = attachWebSocketServer(server, container, authClient);

const callbackJob = new CallbackScheduler(container.callbacks, env.CALLBACK_JOB_INTERVAL_SECONDS * 1000);
callbackJob.start();

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "API listening (ws at /ws)");
});

async function shutdown() {
  callbackJob.stop();
  wss.close();
  server.close();
  await Promise.allSettled([container.bus.close(), prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
