import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { logger } from "@config/logger.js";
import {
  attachmentParams,
  conversationAttachmentParams,
  downloadQuery,
  listQuery,
  messageAudioParams,
  uploadFields,
  voiceFields,
} from "./attachment.schema.js";
import { RangeNotSatisfiable, type AttachmentService, type FileResponse } from "./attachment.service.js";

/** Content-Disposition with a safe ASCII fallback and the real name encoded (RFC 6266 / 5987). */
const disposition = (kind: "inline" | "attachment", name: string) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

export class AttachmentController {
  constructor(private readonly service: AttachmentService) {}

  upload = async (req: Request, res: Response) => {
    const { message, created } = await this.service.upload(getAuth(req), parsed(req, "body", uploadFields), req.file);
    res.status(created ? 201 : 200).json({ status: "success", data: message });
  };

  uploadVoice = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationAttachmentParams);
    const { message, created } = await this.service.uploadVoice(
      getAuth(req),
      conversationId,
      parsed(req, "body", voiceFields),
      req.file,
    );
    res.status(created ? 201 : 200).json({ status: "success", data: message });
  };

  list = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationAttachmentParams);
    const { items, meta } = await this.service.list(getAuth(req), conversationId, parsed(req, "query", listQuery));
    res.json({ status: "success", data: items, meta });
  };

  get = async (req: Request, res: Response) => {
    const { attachmentId } = parsed(req, "params", attachmentParams);
    res.json({ status: "success", data: await this.service.get(getAuth(req), attachmentId) });
  };

  download = async (req: Request, res: Response) => {
    const { attachmentId } = parsed(req, "params", attachmentParams);
    const { inline } = parsed(req, "query", downloadQuery);
    await this.send(req, res, () =>
      this.service.download(getAuth(req), attachmentId, { range: req.headers.range, inline }),
    );
  };

  audio = async (req: Request, res: Response) => {
    const { messageId } = parsed(req, "params", messageAudioParams);
    await this.send(req, res, () => this.service.messageAudio(getAuth(req), messageId, { range: req.headers.range }));
  };

  remove = async (req: Request, res: Response) => {
    const { attachmentId } = parsed(req, "params", attachmentParams);
    res.json({ status: "success", data: await this.service.remove(getAuth(req), attachmentId) });
  };

  /** Streams a stored file with the headers that keep it from being run by the browser. */
  private async send(_req: Request, res: Response, load: () => Promise<FileResponse>) {
    let file: FileResponse;
    try {
      file = await load();
    } catch (error) {
      if (error instanceof RangeNotSatisfiable) res.setHeader("Content-Range", `bytes */${error.size}`);
      throw error;
    }
    const length = file.range ? file.range.end - file.range.start + 1 : file.size;
    res.status(file.status);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(length));
    res.setHeader("Accept-Ranges", "bytes");
    if (file.range) res.setHeader("Content-Range", `bytes ${file.range.start}-${file.range.end}/${file.size}`);
    res.setHeader("Content-Disposition", disposition(file.inline ? "inline" : "attachment", file.fileName));
    // Private: only for the signed-in agent. Never cached by shared caches. The sandbox policy stops a file from running as a page.
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");

    file.stream.on("error", (error) => {
      logger.warn({ err: error }, "reading a stored file failed");
      // Headers are out already; cutting the connection tells the client the file is incomplete.
      res.destroy(error);
    });
    res.on("close", () => file.stream.destroy());
    file.stream.pipe(res);
  }
}
