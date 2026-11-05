import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { container } from "../../app-container.js";
import { NotificationController } from "./notification.controller.js";
import { listQuery, muteBody, preferencesBody } from "./notification.schema.js";

const controller = new NotificationController(container.notifications);

/** Mounted at /api/notifications (authentication is applied at the mount). */
export const notificationRoutes = Router();

notificationRoutes.get("/", validate({ query: listQuery }), controller.list);
notificationRoutes.get("/unread-count", controller.unreadCount);
notificationRoutes.post("/read-all", controller.markAllRead);
notificationRoutes.get("/preferences", controller.getPreferences);
notificationRoutes.put("/preferences", validate({ body: preferencesBody }), controller.updatePreferences);
notificationRoutes.patch("/:id/read", validate({ params: idParams }), controller.markRead);

/** Mounted at /api/conversations next to the other conversation routes. */
export const conversationMuteRoutes = Router();

conversationMuteRoutes.put("/:id/mute", validate({ params: idParams, body: muteBody }), controller.mute);
