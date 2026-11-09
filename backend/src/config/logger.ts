import { pino } from "pino";
import { env } from "./env.js";
import { requestContext } from "./request-context.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  // Every line logged while handling a request carries its requestId.
  mixin: () => requestContext.getStore() ?? {},
  // pino-http logs request headers: access tokens and cookies must never reach the logs.
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
    censor: "[redacted]",
  },
  ...(env.NODE_ENV === "development" && { transport: { target: "pino-pretty" } }),
});
