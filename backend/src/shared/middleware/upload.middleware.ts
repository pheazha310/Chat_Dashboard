import type { RequestHandler } from "express";
import multer from "multer";
import { env } from "@config/env.js";
import { AppError, BadRequestError } from "@shared/errors/AppError.js";

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 10, fieldSize: 64 * 1024, parts: 12 },
});

/**
 * Reads one multipart file field named `file` into `req.file` (and the other fields into `req.body`).
 * Size and shape problems become normal API errors instead of multer's own.
 */
export const uploadFile: RequestHandler = (req, res, next) => {
  parser.single("file")(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return next(new AppError(413, "PAYLOAD_TOO_LARGE", `The file is larger than ${env.MAX_UPLOAD_BYTES} bytes`));
      }
      return next(new BadRequestError(`Invalid upload: ${error.message}`));
    }
    next(error);
  });
};
