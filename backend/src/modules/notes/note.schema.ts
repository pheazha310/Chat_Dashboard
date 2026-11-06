import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";

export const MAX_NOTE_LENGTH = 4000;
export const MAX_MENTIONS = 10;

export const noteParams = z.object({ noteId: idSchema });

const mentions = z.array(idSchema).max(MAX_MENTIONS);

export const createNoteBody = z.object({
  text: z.string().trim().min(1).max(MAX_NOTE_LENGTH),
  /** Backend 1 ids of agents to notify. The ids are explicit: the server does not parse `@names` out of the text. */
  mentionedAgentIds: mentions.default([]),
});
export type CreateNoteInput = z.infer<typeof createNoteBody>;

export const updateNoteBody = z
  .object({
    text: z.string().trim().min(1).max(MAX_NOTE_LENGTH).optional(),
    /** The complete new list. Agents added by this edit are notified; agents left out are no longer mentioned. */
    mentionedAgentIds: mentions.optional(),
  })
  .refine(
    (value) => value.text !== undefined || value.mentionedAgentIds !== undefined,
    "Send text or mentionedAgentIds",
  );
export type UpdateNoteInput = z.infer<typeof updateNoteBody>;
