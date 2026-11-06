import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { MAX_TEXT_LENGTH } from "@modules/messages/message.schema.js";

export const templateParams = z.object({ templateId: idSchema });

const title = z.string().trim().min(1).max(255);
const content = z.string().trim().min(1).max(MAX_TEXT_LENGTH);
/** `/greeting`: a slash, then letters, digits, `_` or `-`. */
const shortcut = z
  .string()
  .trim()
  .regex(/^\/[a-zA-Z0-9_-]{1,49}$/, "Use a shortcut like /greeting");

export const createBody = z.object({
  title,
  content,
  shortcut: shortcut.optional(),
  /** PERSONAL (default) is private to you. SHARED is visible to everyone and needs a supervisor. */
  scope: z.enum(["PERSONAL", "SHARED"]).default("PERSONAL"),
});
export type CreateInput = z.infer<typeof createBody>;

export const updateBody = z
  .object({
    title: title.optional(),
    content: content.optional(),
    /** `null` removes the shortcut. */
    shortcut: shortcut.nullable().optional(),
    /** `false` deactivates, `true` brings it back. */
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), "Send at least one field");
export type UpdateInput = z.infer<typeof updateBody>;

export const listQuery = pageQuery.extend({
  size: z.coerce.number().int().min(1).max(200).default(50),
  /** Case-insensitive search in title, text and shortcut. */
  q: z.string().trim().min(1).max(100).optional(),
  scope: z.enum(["PERSONAL", "SHARED"]).optional(),
  /** Exact shortcut (ignoring case), to resolve what the agent typed. */
  shortcut: shortcut.optional(),
  /** Also list deactivated templates the caller can manage. */
  includeInactive: z
    .enum(["1", "true", "0", "false"])
    .optional()
    .transform((value) => value === "1" || value === "true"),
});
export type ListQuery = z.infer<typeof listQuery>;
