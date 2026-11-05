import { z } from "zod";

export const setPresenceBody = z.object({ status: z.enum(["AVAILABLE", "BUSY", "AWAY"]) });
export type SetPresenceInput = z.infer<typeof setPresenceBody>;
