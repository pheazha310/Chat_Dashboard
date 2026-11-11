import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { container } from "../../app-container.js";
import { MessageActionController } from "./message-action.controller.js";
import { MessageController } from "./message.controller.js";
import { searchAllQuery } from "./message.schema.js";
import {
  editBody,
  forwardBody,
  messageIdParams,
  reactionBody,
  reactionParams,
  replyBody,
} from "./message-action.schema.js";

const controller = new MessageActionController(container.messageActions);
const messages = new MessageController(container.messages);

/** Mounted at /api/v1/admin/messages (authentication is applied at the mount). */
export const messageActionRoutes = Router();

messageActionRoutes.get("/search", validate({ query: searchAllQuery }), messages.searchAll);

messageActionRoutes.post(
  "/:messageId/replies",
  validate({ params: messageIdParams, body: replyBody }),
  controller.reply,
);
messageActionRoutes.patch("/:messageId", validate({ params: messageIdParams, body: editBody }), controller.edit);
messageActionRoutes.delete("/:messageId", validate({ params: messageIdParams }), controller.remove);
messageActionRoutes.get("/:messageId/history", validate({ params: messageIdParams }), controller.history);
messageActionRoutes.put(
  "/:messageId/reactions",
  validate({ params: messageIdParams, body: reactionBody }),
  controller.react,
);
messageActionRoutes.delete(
  "/:messageId/reactions/:reactionId",
  validate({ params: reactionParams }),
  controller.unreact,
);
messageActionRoutes.put("/:messageId/pin", validate({ params: messageIdParams }), controller.pin);
messageActionRoutes.delete("/:messageId/pin", validate({ params: messageIdParams }), controller.unpin);
messageActionRoutes.post(
  "/:messageId/forwards",
  validate({ params: messageIdParams, body: forwardBody }),
  controller.forward,
);
