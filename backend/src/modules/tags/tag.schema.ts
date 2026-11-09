import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";

export const MAX_TAGS_PER_CONVERSATION = 20;

export const tagParams = z.object({ tagId: idSchema });
export const conversationTagParams = z.object({ id: idSchema });

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #3b6df0");
const name = z.string().trim().min(1).max(100);

export const createTagBody = z.object({ name, color: color.optional() });
export type CreateTagInput = z.infer<typeof createTagBody>;

export const updateTagBody = z
  .object({ name: name.optional(), color: color.nullable().optional() })
  .refine((value) => value.name !== undefined || value.color !== undefined, "Send name or color");
export type UpdateTagInput = z.infer<typeof updateTagBody>;

export const listTagsQuery = pageQuery.extend({
  size: z.coerce.number().int().min(1).max(200).default(100),
  /** Case-insensitive search in the name. */
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListTagsQuery = z.infer<typeof listTagsQuery>;

export const deleteTagQuery = z.object({
  /** Remove the tag even though conversations use it: it is taken off all of them first. Supervisors only. */
  force: z
    .enum(["1", "true", "0", "false"])
    .optional()
    .transform((value) => value === "1" || value === "true"),
});

/** The complete set of tags the conversation should have. An empty list removes them all. */
export const setTagsBody = z.object({
  tagIds: z
    .array(idSchema)
    .max(MAX_TAGS_PER_CONVERSATION)
    .transform((ids) => [...new Set(ids)]),
});
export type SetTagsInput = z.infer<typeof setTagsBody>;
