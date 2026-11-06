import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { BEARER_AUTH } from "@shared/openapi/registry.js";
import { errorEnvelope, errors, ok, pagedOf, successOf } from "@shared/openapi/envelopes.js";
import { attachment, message } from "@modules/messages/message.openapi.js";
import {
  attachmentParams,
  conversationAttachmentParams,
  downloadQuery,
  listQuery,
  messageAudioParams,
} from "./attachment.schema.js";

const multipart = (fields: z.ZodRawShape) => ({
  required: true,
  content: { "multipart/form-data": { schema: z.object({ file: z.string().meta({ format: "binary" }), ...fields }) } },
});

const binary = (description: string) => ({
  description,
  content: { "application/octet-stream": { schema: z.string().meta({ format: "binary" }) } },
});

const security = [{ [BEARER_AUTH]: [] }];
const tags = ["Attachments"];
const failures = { 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404] };
const tooLarge = {
  description: "The upload exceeds MAX_UPLOAD_BYTES",
  content: { "application/json": { schema: errorEnvelope } },
};
const deleted = z.object({ id: z.string(), conversationId: z.string(), messageId: z.string().nullable() });

export function registerAttachmentOpenApi(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "post",
    path: "/attachments/upload",
    tags,
    security,
    summary: "Send a file",
    description:
      "Multipart: `file`, `conversationId`, `clientId`, optional `text` caption. Stores the file and sends a message carrying it (type IMAGE, FILE, AUDIO or VIDEO). Allowed: JPEG, PNG, GIF, WebP, PDF, TXT, CSV, DOC(X), XLS(X), MP3, OGG, WAV, WebM, M4A, MP4, MOV. The MIME type, the extension and the file's first bytes must agree; images 10 MB, other files up to 25 MB. Only the owner of an open conversation. Idempotent by `clientId` (200 on a retry). Broadcast as `message.new` and `attachment.uploaded`. If storing the message fails, the stored file is removed.",
    request: {
      body: multipart({ conversationId: z.string(), clientId: z.string(), text: z.string().optional() }),
    },
    responses: {
      201: ok("Created", successOf(message)),
      200: ok("Already sent with this clientId", successOf(message)),
      ...failures,
      409: errors[409],
      413: tooLarge,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/conversations/{conversationId}/voice-messages",
    tags,
    security,
    summary: "Send a voice message",
    description:
      "Multipart: `file` (an audio recording, max 10 MB), `clientId`, optional `durationMs` (measured by the browser, up to 10 minutes) and `waveform` (a JSON array of up to 200 integers 0 to 255). The message has type VOICE. Same rules as sending a file.",
    request: {
      params: conversationAttachmentParams,
      body: multipart({
        clientId: z.string(),
        durationMs: z.number().int().optional(),
        waveform: z.string().optional(),
      }),
    },
    responses: {
      201: ok("Created", successOf(message)),
      200: ok("Already sent with this clientId", successOf(message)),
      ...failures,
      409: errors[409],
      413: tooLarge,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/conversations/{conversationId}/attachments",
    tags,
    security,
    summary: "Shared media and files",
    description:
      "Newest first. Filter with `kind`: image, document, audio, video or voice. Deleted files are not listed.",
    request: { params: conversationAttachmentParams, query: listQuery },
    responses: { 200: ok("A page of attachments", pagedOf(attachment)), ...failures },
  });
  registry.registerPath({
    method: "get",
    path: "/attachments/{attachmentId}",
    tags,
    security,
    summary: "Attachment details",
    request: { params: attachmentParams },
    responses: { 200: ok("Attachment", successOf(attachment)), ...failures },
  });
  registry.registerPath({
    method: "get",
    path: "/attachments/{attachmentId}/download",
    tags,
    security,
    summary: "Preview or download a file",
    description:
      "Streams the file after checking the caller may see its conversation. Needs the bearer token, so the browser fetches it and shows the bytes from a blob URL. `?inline=1` displays images, audio and video; every other type is always sent as a download. Supports one `Range` (206) so audio and video can seek. Sent with `Cache-Control: private`, `nosniff` and a sandbox CSP.",
    request: { params: attachmentParams, query: downloadQuery },
    responses: {
      200: binary("The file"),
      206: binary("The requested byte range"),
      ...failures,
      416: { description: "The range is outside the file", content: { "application/json": { schema: errorEnvelope } } },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/messages/{messageId}/audio",
    tags,
    security,
    summary: "Play a voice message",
    description: "The audio of a voice or audio message, streamed inline with `Range` support.",
    request: { params: messageAudioParams },
    responses: { 200: binary("The audio"), 206: binary("The requested byte range"), ...failures },
  });
  registry.registerPath({
    method: "delete",
    path: "/attachments/{attachmentId}",
    tags,
    security,
    summary: "Delete a file",
    description:
      "The uploader or a supervisor/admin. The record is kept (soft delete) and the stored bytes are removed. Broadcast as `attachment.deleted`. Deleting the message removes its files the same way.",
    request: { params: attachmentParams },
    responses: { 200: ok("Deleted", successOf(deleted)), ...failures },
  });
}
