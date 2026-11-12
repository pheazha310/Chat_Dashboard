import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { corsOptions } from "@config/cors.js";
import { env } from "@config/env.js";
import { logger } from "@config/logger.js";
import { errorHandler } from "@shared/middleware/error-handler.middleware.js";
import { notFound } from "@shared/middleware/not-found.middleware.js";
import { withRequestContext } from "@shared/middleware/request-context.middleware.js";
import { healthRoutes } from "@modules/health/index.js";
import {
  ADMIN_API_PREFIX,
  AGENT_APP_PREFIX,
  AGENTS_API_PREFIX,
  CUSTOMER_APP_PREFIX,
  CUSTOMER_API_PREFIX,
  DEV_API_PREFIX,
  agentAppRouter,
  apiRouter,
  customerAppRouter,
  customerApiRouter,
  devApiRouter,
} from "./routes.js";

export const app = express();

// Behind a load balancer the client IP (sign-in rate limit, session records) comes from X-Forwarded-For.
app.set("trust proxy", env.TRUST_PROXY);

app.use(helmet());
app.use(cors(corsOptions));
app.use(withRequestContext);
app.use(pinoHttp({ logger }));
app.use(express.json());

// Liveness/readiness probes keep a stable, unversioned path outside the staff namespace.
app.use("/api/health", healthRoutes);
app.use(ADMIN_API_PREFIX, apiRouter);
app.use(AGENTS_API_PREFIX, apiRouter);
app.use(CUSTOMER_API_PREFIX, customerApiRouter);
app.use(CUSTOMER_APP_PREFIX, customerAppRouter);
app.use(AGENT_APP_PREFIX, agentAppRouter);
// Password-less test sign-in. Not mounted otherwise, so it is a plain 404 with AUTH_MODE=jwt and in production.
if (env.AUTH_MODE === "dev") app.use(DEV_API_PREFIX, devApiRouter);

app.use(notFound);
app.use(errorHandler);
