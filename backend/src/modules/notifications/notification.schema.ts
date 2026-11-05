import { z } from "zod";
import { pageQuery } from "@shared/utils/pagination.js";

export const listQuery = pageQuery.extend({
  /** Only unread notifications. */
  unread: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});
export type ListQuery = z.infer<typeof listQuery>;

export const muteBody = z.object({ muted: z.boolean() });

/** Any subset of the switches; at least one. */
export const preferencesBody = z
  .object({
    newMessage: z.boolean(),
    assignment: z.boolean(),
    transfer: z.boolean(),
    mention: z.boolean(),
    sound: z.boolean(),
    browser: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one preference");
export type PreferencesInput = z.infer<typeof preferencesBody>;
