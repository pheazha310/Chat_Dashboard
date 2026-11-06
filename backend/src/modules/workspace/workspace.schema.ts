import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";

export const MAX_OPEN_TABS = 20;
export const MAX_DRAFT_LENGTH = 10_000;

export const conversationParams = z.object({ conversationId: idSchema });

export const preferencesBody = z
  .object({ restoreTabs: z.boolean(), persistTabs: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Send at least one preference");
export type PreferencesInput = z.infer<typeof preferencesBody>;

export const draftBody = z.object({ content: z.string().max(MAX_DRAFT_LENGTH) });
export type DraftInput = z.infer<typeof draftBody>;
