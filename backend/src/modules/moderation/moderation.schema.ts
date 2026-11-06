import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";

export const MAX_ACTIVE_KEYWORDS = 1000;

const reason = z.string().trim().min(1).max(2000);
const note = z.string().trim().max(500);

export const customerParams = z.object({ customerId: idSchema });
export const keywordParams = z.object({ keywordId: idSchema });
export const reportParams = z.object({ reportId: idSchema });

export const blockBody = z.object({
  reason: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => value || undefined),
});
export type BlockInput = { reason?: string | undefined };

export const listBlocksQuery = pageQuery.extend({
  /** `true` (default): current blocks. `false`: lifted ones. */
  active: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});
export type ListBlocksQuery = z.infer<typeof listBlocksQuery>;

/** A keyword is matched as a plain piece of text, ignoring case. Control characters are refused. */
const keyword = z
  .string()
  .trim()
  .min(1)
  .max(255)
  // eslint-disable-next-line no-control-regex
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "No control characters");

export const createKeywordBody = z.object({ keyword });
export const updateKeywordBody = z
  .object({ keyword, isActive: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Send at least one field");
export type UpdateKeywordInput = z.infer<typeof updateKeywordBody>;

export const listKeywordsQuery = pageQuery.extend({ q: z.string().trim().max(100).optional() });
export type ListKeywordsQuery = z.infer<typeof listKeywordsQuery>;

export const reportSpamBody = z.object({ reason, messageId: idSchema.optional() });
export type ReportSpamInput = z.infer<typeof reportSpamBody>;

export const listReportsQuery = pageQuery.extend({
  status: z.enum(["PENDING", "CONFIRMED", "DISMISSED"]).optional(),
});
export type ListReportsQuery = z.infer<typeof listReportsQuery>;

export const reviewReportBody = z.object({
  status: z.enum(["CONFIRMED", "DISMISSED"]),
  resolutionNote: note.optional().transform((value) => value || undefined),
  /** With CONFIRMED: also block the conversation's customer, in the same step. */
  blockCustomer: z.boolean().optional(),
});
export type ReviewReportInput = {
  status: "CONFIRMED" | "DISMISSED";
  resolutionNote?: string | undefined;
  blockCustomer?: boolean | undefined;
};

export const listActivitiesQuery = pageQuery.extend({
  targetType: z.enum(["CUSTOMER", "CONVERSATION", "MESSAGE", "KEYWORD", "SPAM_REPORT"]).optional(),
  actorId: idSchema.optional(),
});
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuery>;
