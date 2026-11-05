import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { cursorQuery } from "@shared/utils/pagination.js";
import { container } from "../../app-container.js";
import { MessageController } from "./message.controller.js";
import { messageParams, readBody, sendBody } from "./message.schema.js";

const controller = new MessageController(container.messages);

/** Mounted at /api/conversations (authentication is applied at the mount). */
export const messageRoutes = Router();

messageRoutes.post("/:id/messages", validate({ params: idParams, body: sendBody }), controller.send);
messageRoutes.get("/:id/messages", validate({ params: idParams, query: cursorQuery }), controller.history);
messageRoutes.post("/:id/messages/:messageId/delivered", validate({ params: messageParams }), controller.markDelivered);
messageRoutes.post("/:id/read", validate({ params: idParams, body: readBody }), controller.markRead);
messageRoutes.post("/:id/unread", validate({ params: idParams }), controller.markUnread);
