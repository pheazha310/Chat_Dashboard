import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";

export const listQuery = pageQuery.extend({
  filter: z.enum(["all", "mine", "unread", "unassigned", "archived"]).default("all"),
  status: z.enum(["OPEN", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  tag: idSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

export const createBody = z.object({
  customerId: idSchema,
  applicationId: idSchema.optional(),
  customerName: z.string().trim().min(1).max(150).optional(),
  customerIdentifier: z.string().trim().min(1).max(100).optional(),
  subject: z.string().trim().min(1).max(255).optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
});
export type CreateInput = z.infer<typeof createBody>;

export const statusBody = z.object({ status: z.enum(["OPEN", "RESOLVED", "CLOSED"]) });
