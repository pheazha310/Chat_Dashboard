import { Router } from "express";
import { uploadFile } from "@shared/middleware/upload.middleware.js";
import { validate } from "@shared/middleware/validate.middleware.js";
import { cursorQuery } from "@shared/utils/pagination.js";
import { voiceFields } from "@modules/attachments/attachment.schema.js";
import { container } from "../../app-container.js";
import { CustomerChannelController } from "./customer-channel.controller.js";
import { CustomerChannelService } from "./customer-channel.service.js";
import {
  attachmentParams,
  conversationParams,
  downloadQuery,
  fileFields,
  joinBody,
  messageAudioParams,
  sendBody,
} from "./customer-channel.schema.js";

const controller = new CustomerChannelController(
  new CustomerChannelService(container.conversations, container.messages, container.attachments),
);

/** Mounted at /api/v1/customer (customer authentication is applied at the mount). */
export const customerChannelRoutes = Router();

customerChannelRoutes.post("/conversations/join", validate({ body: joinBody }), controller.join);
customerChannelRoutes.get(
  "/conversations/:conversationId",
  validate({ params: conversationParams }),
  controller.conversation,
);
customerChannelRoutes.get(
  "/conversations/:conversationId/messages",
  validate({ params: conversationParams, query: cursorQuery }),
  controller.history,
);
customerChannelRoutes.post(
  "/conversations/:conversationId/messages",
  validate({ params: conversationParams, body: sendBody }),
  controller.sendText,
);
customerChannelRoutes.post(
  "/conversations/:conversationId/files",
  uploadFile,
  validate({ params: conversationParams, body: fileFields }),
  controller.sendFile,
);
customerChannelRoutes.post(
  "/conversations/:conversationId/voice-messages",
  uploadFile,
  validate({ params: conversationParams, body: voiceFields }),
  controller.sendVoice,
);
customerChannelRoutes.get(
  "/attachments/:attachmentId/download",
  validate({ params: attachmentParams, query: downloadQuery }),
  controller.download,
);
customerChannelRoutes.get("/messages/:messageId/audio", validate({ params: messageAudioParams }), controller.audio);
