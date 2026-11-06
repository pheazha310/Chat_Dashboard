import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { container } from "../../app-container.js";
import { ChatSettingsController } from "./chat-settings.controller.js";
import { chatSettingsBody } from "./chat-settings.schema.js";

const controller = new ChatSettingsController(container.chatSettings);

/** Mounted at /api/v1/admin/agents (authentication is applied at the mount). Only the caller's own settings. */
export const chatSettingsRoutes = Router();

chatSettingsRoutes.get("/me/chat-settings", controller.get);
chatSettingsRoutes.patch("/me/chat-settings", validate({ body: chatSettingsBody }), controller.update);
