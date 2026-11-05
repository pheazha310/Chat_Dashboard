import { Router } from "express";
import { authClient } from "@shared/auth/auth.js";
import { authenticate } from "@shared/middleware/auth.middleware.js";
import { assignmentRoutes } from "@modules/assignments/index.js";
import { conversationRoutes } from "@modules/conversations/index.js";
import { messageRoutes } from "@modules/messages/index.js";
import { healthRoutes } from "@modules/health/index.js";
import { buildOpenApiDocument } from "./openapi.js";

// Mount each module's router here under /api.
export const apiRouter = Router();

// The API contract as OpenAPI 3.1 JSON. Public: it describes the API and contains no data. Built once, on first use.
let openApiDocument: ReturnType<typeof buildOpenApiDocument> | undefined;
apiRouter.get("/openapi.json", (_req, res) => {
  res.json((openApiDocument ??= buildOpenApiDocument()));
});

apiRouter.use("/health", healthRoutes);
// Every conversation route requires a verified dashboard user (agent, supervisor or admin).
apiRouter.use("/conversations", authenticate(authClient), conversationRoutes, assignmentRoutes, messageRoutes);
