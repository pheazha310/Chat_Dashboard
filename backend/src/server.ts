import { createServer } from "node:http";
import { app } from "./app.js";
import { prisma } from "@config/database.js";
import { env } from "@config/env.js";
import { logger } from "@config/logger.js";
import { redis } from "@config/redis.js";
import { authClient, authService, container } from "./app-container.js";
import { CallbackScheduler } from "@modules/callbacks/callback.scheduler.js";
import { IntervalJob } from "@shared/utils/interval-job.js";
import { attachWebSocketServer } from "./websocket/websocket.server.js";

const server = createServer(app);
const wss = attachWebSocketServer(server, container, authClient);

const callbackJob = new CallbackScheduler(container.callbacks, env.CALLBACK_JOB_INTERVAL_SECONDS * 1000);
callbackJob.start();
const callJob = new IntervalJob("call", () => container.calls.processDue(), env.CALL_JOB_INTERVAL_SECONDS * 1000);
callJob.start();
const sessionCleanupJob = new IntervalJob(
  "session cleanup",
  () => authService.pruneExpiredSessions(),
  env.AUTH_SESSION_CLEANUP_INTERVAL_MINUTES * 60_000,
);
sessionCleanupJob.start();

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "API listening (ws at /ws)");
});

async function shutdown() {
  callbackJob.stop();
  callJob.stop();
  sessionCleanupJob.stop();
  wss.close();
  server.close();
  await Promise.allSettled([container.bus.close(), prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
