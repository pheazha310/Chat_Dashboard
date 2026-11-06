import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";

export const MAX_PENDING_PER_CONVERSATION = 20;
/** The furthest ahead a callback can be scheduled. */
export const MAX_SCHEDULE_AHEAD_DAYS = 365;

export const callbackParams = z.object({ callbackId: idSchema });

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).transform((value) => value || null);

// Offsets are required, so "2026-05-01T09:00" (no zone) is refused instead of being read in the server's time zone.
const when = z.string().datetime({ offset: true }).pipe(z.coerce.date());

export const createCallbackBody = z.object({
  scheduledAt: when,
  notes: optionalText(2000).optional(),
  assignedAgentId: idSchema.optional(),
});
export type CreateCallbackInput = z.infer<typeof createCallbackBody>;

export const updateCallbackBody = z
  .object({ scheduledAt: when, notes: optionalText(2000), assignedAgentId: idSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Send at least one field");
export type UpdateCallbackInput = z.infer<typeof updateCallbackBody>;

export const completeCallbackBody = z.object({ completionNote: optionalText(2000).optional() });
export type CompleteCallbackInput = z.infer<typeof completeCallbackBody>;

export const listCallbacksQuery = pageQuery.extend({
  status: z.enum(["PENDING", "COMPLETED", "CANCELLED", "MISSED"]).optional(),
  /** `mine` (default): assigned to me or scheduled by me. `all` is for supervisors. */
  scope: z.enum(["mine", "all"]).default("mine"),
  from: when.optional(),
  to: when.optional(),
});
export type ListCallbacksQuery = z.infer<typeof listCallbacksQuery>;
