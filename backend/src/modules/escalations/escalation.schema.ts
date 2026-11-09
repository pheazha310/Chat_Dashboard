import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";

export const escalationParams = z.object({ escalationId: idSchema });

export const createEscalationBody = z.object({
  reason: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => value || undefined),
});
export type CreateEscalationInput = { reason?: string | undefined };

export const updateEscalationBody = z.object({ status: z.enum(["RESOLVED", "CANCELLED"]) });
export type UpdateEscalationInput = z.infer<typeof updateEscalationBody>;
