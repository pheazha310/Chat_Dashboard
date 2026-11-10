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
  callParams,
  conversationParams,
  downloadQuery,
  fileFields,
  joinBody,
  messageAudioParams,
  sendBody,
  startCallBody,
} from "./customer-channel.schema.js";

const controller = new CustomerChannelController(
  new CustomerChannelService(container.conversations, container.messages, container.attachments, container.calls),
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

// Calls: the customer's half (docs/api-calls.md). Signalling (offer/answer/ICE) stays on the WebSocket.
customerChannelRoutes.post(
  "/conversations/:conversationId/calls",
  validate({ params: conversationParams, body: startCallBody }),
  controller.startCall,
);
customerChannelRoutes.post(
  "/calls/:callId/accept",
  validate({ params: callParams }),
  controller.callAction("acceptCall"),
);
customerChannelRoutes.post(
  "/calls/:callId/decline",
  validate({ params: callParams }),
  controller.callAction("declineCall"),
);
customerChannelRoutes.post(
  "/calls/:callId/cancel",
  validate({ params: callParams }),
  controller.callAction("cancelCall"),
);
customerChannelRoutes.post("/calls/:callId/end", validate({ params: callParams }), controller.callAction("endCall"));
