import { z } from "zod";

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof pageQuery>;

export const pageArgs = ({ page, size }: PageQuery) => ({ skip: (page - 1) * size, take: size });

/** `meta` of the paginated envelope in docs/api-response-contracts.md. */
export const pageMeta = (total: number, { page, size }: PageQuery) => ({
  total,
  page,
  size,
  totalPages: Math.max(1, Math.ceil(total / size)),
});

/** Cursor pagination for message history: `before`/`after` are message sequence numbers. */
export const cursorQuery = z
  .object({
    before: z.coerce.bigint().positive().optional(),
    after: z.coerce.bigint().nonnegative().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((q) => q.before === undefined || q.after === undefined, "Use either before or after, not both");
export type CursorQuery = z.infer<typeof cursorQuery>;
