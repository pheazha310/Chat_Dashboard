import { Router } from "express";
import { authClient } from "@shared/auth/auth.js";
import { authenticate } from "@shared/middleware/auth.middleware.js";
import { assignmentRoutes } from "@modules/assignments/index.js";
import { conversationRoutes } from "@modules/conversations/index.js";
import { attachmentRoutes, conversationAttachmentRoutes, messageAudioRoutes } from "@modules/attachments/index.js";
import { messageActionRoutes, messageRoutes } from "@modules/messages/index.js";
import { customerRoutes } from "@modules/customers/index.js";
import { conversationMuteRoutes, notificationRoutes } from "@modules/notifications/index.js";
import { presenceRoutes } from "@modules/presence/index.js";
import { conversationEscalationRoutes, escalationRoutes } from "@modules/escalations/index.js";
import { conversationNoteRoutes, noteRoutes } from "@modules/notes/index.js";
import { conversationTagRoutes, tagRoutes } from "@modules/tags/index.js";
import { cannedResponseRoutes } from "@modules/canned-responses/index.js";
import { callRoutes, conversationCallRoutes } from "@modules/calls/index.js";
import { callbackRoutes, conversationCallbackRoutes } from "@modules/callbacks/index.js";
import { chatSettingsRoutes } from "@modules/chat-settings/index.js";
import { workspaceRoutes } from "@modules/workspace/index.js";
import { buildOpenApiDocument } from "./openapi.js";

/** Namespace of the internal-staff API (agents, supervisors, admins). Customer and guest APIs use their own prefixes. */
export const ADMIN_API_PREFIX = "/api/v1/admin";

// Mount each module's router here; app.ts serves it under ADMIN_API_PREFIX.
export const apiRouter = Router();

// The API contract as OpenAPI 3.1 JSON. Public: it describes the API and contains no data. Built once, on first use.
let openApiDocument: ReturnType<typeof buildOpenApiDocument> | undefined;
apiRouter.get("/openapi.json", (_req, res) => {
  res.json((openApiDocument ??= buildOpenApiDocument()));
});

// Every conversation route requires a verified dashboard user (agent, supervisor or admin).
apiRouter.use(
  "/conversations",
  authenticate(authClient),
  conversationRoutes,
  assignmentRoutes,
  messageRoutes,
  customerRoutes,
  conversationMuteRoutes,
  conversationAttachmentRoutes,
  conversationNoteRoutes,
  conversationEscalationRoutes,
  conversationTagRoutes,
  conversationCallbackRoutes,
  conversationCallRoutes,
);
apiRouter.use("/presence", authenticate(authClient), presenceRoutes);
apiRouter.use("/notifications", authenticate(authClient), notificationRoutes);
apiRouter.use("/workspace", authenticate(authClient), workspaceRoutes);
apiRouter.use("/calls", authenticate(authClient), callRoutes);
apiRouter.use("/callbacks", authenticate(authClient), callbackRoutes);
apiRouter.use("/agents", authenticate(authClient), chatSettingsRoutes);
apiRouter.use("/messages", authenticate(authClient), messageActionRoutes, messageAudioRoutes);
apiRouter.use("/canned-responses", authenticate(authClient), cannedResponseRoutes);
apiRouter.use("/tags", authenticate(authClient), tagRoutes);
apiRouter.use("/notes", authenticate(authClient), noteRoutes);
apiRouter.use("/escalations", authenticate(authClient), escalationRoutes);
apiRouter.use("/attachments", authenticate(authClient), attachmentRoutes);
