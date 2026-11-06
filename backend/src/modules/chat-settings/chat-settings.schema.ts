import { z } from "zod";

export const chatSettingsBody = z
  .object({
    typingSoundEnabled: z.boolean(),
    notificationSoundEnabled: z.boolean(),
    aiSuggestionsEnabled: z.boolean(),
    aiSummariesEnabled: z.boolean(),
    autoAssignEnabled: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Send at least one setting");
export type ChatSettingsInput = z.infer<typeof chatSettingsBody>;
