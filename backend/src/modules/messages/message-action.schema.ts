import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";
import { MAX_TEXT_LENGTH } from "./message.schema.js";

export const messageIdParams = z.object({ messageId: idSchema });
export const reactionParams = z.object({ messageId: idSchema, reactionId: idSchema });

export const MAX_REACTIONS_PER_USER = 10;
/** Pins per conversation: a short list of key facts, not a second history. */
export const MAX_PINS = 10;

export const replyBody = z.object({
  /** Client-generated id; resending it returns the original reply instead of a duplicate. */
  clientId: z.string().trim().min(1).max(100),
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
});
export type ReplyInput = z.infer<typeof replyBody>;

export const editBody = z.object({ text: z.string().trim().min(1).max(MAX_TEXT_LENGTH) });
export type EditInput = z.infer<typeof editBody>;

// One emoji, possibly a sequence (skin tone, ZWJ family, flag, keycap). Plain letters and digits are refused.
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[0-9#*]️?⃣|‍|️)+$/u;
export const reactionBody = z.object({
  emoji: z.string().trim().min(1).max(50).regex(EMOJI, "Must be an emoji"),
});
export type ReactionInput = z.infer<typeof reactionBody>;

export const forwardBody = z.object({
  targetConversationId: idSchema,
  clientId: z.string().trim().min(1).max(100),
});
export type ForwardInput = z.infer<typeof forwardBody>;
