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

// ws re-emits the HTTP server's errors on `wss`; without a listener Node crashes with a raw stack trace.
wss.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
    const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
    const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
    console.error(
      [
        "",
        red(bold(`  ✖ Port ${env.PORT} is already in use`)),
        "",
        "  Another backend is probably still running.",
        "",
        `  ${bold("Fix 1:")} stop it    ${cyan(`lsof -ti :${env.PORT} | xargs kill`)}`,
        `  ${bold("Fix 2:")} new port   ${cyan("set PORT=4001 in backend/.env")}`,
        "",
      ].join("\n"),
    );
  } else {
    logger.error({ err }, "Server failed to start");
  }
  process.exit(1);
});

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
