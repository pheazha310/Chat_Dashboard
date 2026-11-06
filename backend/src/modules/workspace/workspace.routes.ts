import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { container } from "../../app-container.js";
import { WorkspaceController } from "./workspace.controller.js";
import { conversationParams, draftBody, preferencesBody } from "./workspace.schema.js";

const controller = new WorkspaceController(container.workspace);

/** Mounted at /api/v1/admin/workspace (authentication is applied at the mount). Everything is scoped to the caller. */
export const workspaceRoutes = Router();

workspaceRoutes.get("/", controller.get);
workspaceRoutes.patch("/preferences", validate({ body: preferencesBody }), controller.updatePreferences);
workspaceRoutes.put("/tabs/:conversationId", validate({ params: conversationParams }), controller.openTab);
workspaceRoutes.delete("/tabs/:conversationId", validate({ params: conversationParams }), controller.closeTab);
workspaceRoutes.put(
  "/drafts/:conversationId",
  validate({ params: conversationParams, body: draftBody }),
  controller.saveDraft,
);
workspaceRoutes.delete("/drafts/:conversationId", validate({ params: conversationParams }), controller.clearDraft);
