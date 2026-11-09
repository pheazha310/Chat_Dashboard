import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { MAX_TEXT_LENGTH } from "@modules/messages/message.schema.js";

const clientId = z.string().trim().min(1).max(100);

/** Text fields of the multipart upload (the file is the `file` part). */
export const uploadFields = z.object({
  conversationId: idSchema,
  /** Client-generated id; resending the same id returns the original message instead of a duplicate. */
  clientId,
  /** Optional caption shown with the file. */
  text: z
    .string()
    .trim()
    .max(MAX_TEXT_LENGTH)
    .optional()
    .transform((value) => value || undefined),
});
export type UploadFields = z.infer<typeof uploadFields>;

const waveform = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "waveform must be a JSON array" });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.number().int().min(0).max(255)).min(1).max(200));

export const voiceFields = z.object({
  clientId,
  /** Length of the recording in milliseconds, measured by the browser. Up to 10 minutes. */
  durationMs: z.coerce.number().int().min(1).max(600_000).optional(),
  waveform: waveform.optional(),
});
export type VoiceFields = z.infer<typeof voiceFields>;

export const attachmentParams = z.object({ attachmentId: idSchema });
export const messageAudioParams = z.object({ messageId: idSchema });
export const conversationAttachmentParams = z.object({ conversationId: idSchema });

export const KINDS = ["image", "document", "audio", "video", "voice"] as const;
export const listQuery = pageQuery.extend({ kind: z.enum(KINDS).optional() });
export type ListQuery = z.infer<typeof listQuery>;

export const downloadQuery = z.object({
  /** Show the file in the page (images, audio, video) instead of saving it. Other types are always downloaded. */
  inline: z
    .enum(["1", "true", "0", "false"])
    .optional()
    .transform((value) => value === "1" || value === "true"),
});
