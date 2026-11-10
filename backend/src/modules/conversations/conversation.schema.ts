import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";

export const listQuery = pageQuery.extend({
  filter: z.enum(["all", "mine", "unread", "unassigned", "archived"]).default("all"),
  status: z.enum(["OPEN", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  tag: idSchema.optional(),
  /** Comma-separated tag ids (at most 10). Combined with `tag`; see `tagMatch`. */
  tags: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(idSchema).max(10))
    .optional(),
  /** `any`: has at least one of the tags. `all`: has every one of them. */
  tagMatch: z.enum(["any", "all"]).default("any"),
  /** `recent`: latest activity first. `priority`: HIGH, then MEDIUM, then LOW, latest activity first within each. */
  sort: z.enum(["recent", "priority"]).default("recent"),
  /** One customer's conversations (history); includes archived ones unless `filter=archived`. */
  customerId: idSchema.optional(),
  /** Leave one conversation out (e.g. the current one when listing a customer's other conversations). */
  excludeId: idSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
type ParsedListQuery = z.infer<typeof listQuery>;
/** The parsed query. `tagMatch` and `sort` have defaults, so callers building a query by hand may leave them out. */
export type ListQuery = Omit<ParsedListQuery, "tagMatch" | "sort"> &
  Partial<Pick<ParsedListQuery, "tagMatch" | "sort">>;

/** The loan application's number in LOS; stored in an INT column. */
export const applicationIdSchema = z.number().int().positive().max(2147483647);

export const createBody = z.object({
  customerId: idSchema,
  applicationId: applicationIdSchema.optional(),
  customerName: z.string().trim().min(1).max(150).optional(),
  customerIdentifier: z.string().trim().min(1).max(100).optional(),
  subject: z.string().trim().min(1).max(255).optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
});
export type CreateInput = z.infer<typeof createBody>;

export const priorityBody = z.object({ priority: z.enum(["HIGH", "MEDIUM", "LOW"]) });

export const statusBody = z.object({ status: z.enum(["OPEN", "RESOLVED", "CLOSED"]) });
