import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";

const note = z.string().trim().min(1).max(500).optional();

/** Omit `agentId` to assign to yourself (takeover). Assigning to someone else needs a supervisor. */
export const assignBody = z.object({ agentId: idSchema.optional(), note });
export const transferBody = z.object({ agentId: idSchema, note });
export const unassignBody = z.object({ note });
export type AssignInput = z.infer<typeof assignBody>;
