import { Router } from "express";
import { authClient } from "@shared/auth/auth.js";
import { authenticate } from "@shared/middleware/auth.middleware.js";
import { assignmentRoutes } from "@modules/assignments/index.js";
import { conversationRoutes } from "@modules/conversations/index.js";
import { healthRoutes } from "@modules/health/index.js";

// Mount each module's router here under /api.
export const apiRouter = Router();

apiRouter.use("/health", healthRoutes);
// Every conversation route requires a verified dashboard user (agent, supervisor or admin).
apiRouter.use("/conversations", authenticate(authClient), conversationRoutes, assignmentRoutes);
