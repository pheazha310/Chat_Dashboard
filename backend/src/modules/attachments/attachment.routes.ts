import { Router } from "express";
import { uploadFile } from "@shared/middleware/upload.middleware.js";
import { validate } from "@shared/middleware/validate.middleware.js";
import { container } from "../../app-container.js";
import { AttachmentController } from "./attachment.controller.js";
import {
  attachmentParams,
  conversationAttachmentParams,
  downloadQuery,
  listQuery,
  messageAudioParams,
  uploadFields,
  voiceFields,
} from "./attachment.schema.js";

const controller = new AttachmentController(container.attachments);

/** Mounted at /api/v1/admin/attachments (authentication is applied at the mount). */
export const attachmentRoutes = Router();

attachmentRoutes.post("/upload", uploadFile, validate({ body: uploadFields }), controller.upload);
attachmentRoutes.get("/:attachmentId", validate({ params: attachmentParams }), controller.get);
attachmentRoutes.get(
  "/:attachmentId/download",
  validate({ params: attachmentParams, query: downloadQuery }),
  controller.download,
);
attachmentRoutes.delete("/:attachmentId", validate({ params: attachmentParams }), controller.remove);

/** Mounted at /api/v1/admin/conversations. */
export const conversationAttachmentRoutes = Router();

conversationAttachmentRoutes.get(
  "/:conversationId/attachments",
  validate({ params: conversationAttachmentParams, query: listQuery }),
  controller.list,
);
conversationAttachmentRoutes.post(
  "/:conversationId/voice-messages",
  uploadFile,
  validate({ params: conversationAttachmentParams, body: voiceFields }),
  controller.uploadVoice,
);

/** Mounted at /api/v1/admin/messages. */
export const messageAudioRoutes = Router();

messageAudioRoutes.get("/:messageId/audio", validate({ params: messageAudioParams }), controller.audio);
