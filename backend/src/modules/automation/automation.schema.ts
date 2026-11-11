import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";

const text = z.string().trim().min(1).max(2000);

export const autoResponsesBody = z.object({ awayMessage: text, firstResponse: text }).strict();
export type AutoResponsesInput = z.infer<typeof autoResponsesBody>;

export const trainingExampleBody = z.object({ customerMessage: text, suggestedReply: text }).strict();
export type TrainingExampleInput = z.infer<typeof trainingExampleBody>;

export const approvalBody = z.object({ approved: z.boolean() }).strict();
export type ApprovalInput = z.infer<typeof approvalBody>;

export const exampleParams = z.object({ exampleId: idSchema });
