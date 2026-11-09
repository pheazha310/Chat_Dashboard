import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";

export const MAX_TEXT_LENGTH = 4000;

export const sendBody = z.object({
  /** Client-generated id; resending the same id returns the original message instead of a duplicate. */
  clientId: z.string().trim().min(1).max(100),
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  replyToMessageId: idSchema.optional(),
});
export type SendInput = z.infer<typeof sendBody>;

/** Read up to a message (default: the latest). */
export const readBody = z.object({ messageId: idSchema.optional() });

export const messageParams = z.object({ id: idSchema, messageId: idSchema });
