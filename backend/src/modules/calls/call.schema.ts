import { z } from "zod";
import { idSchema } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";

export const callParams = z.object({ callId: idSchema });

export const startCallBody = z.object({ callType: z.enum(["AUDIO", "VIDEO"]).default("AUDIO") });
export type StartCallInput = z.infer<typeof startCallBody>;

export const listCallsQuery = pageQuery;

export const MAX_SDP_LENGTH = 20_000;
export const MAX_CANDIDATE_LENGTH = 2_000;

/** Session descriptions are relayed untouched; only their size and shape are checked. */
export const sdpSignal = z.object({ callId: idSchema, sdp: z.string().min(1).max(MAX_SDP_LENGTH) });

/** An ICE candidate as the browser produces it. `null` means the sender has no more candidates. */
export const candidateSignal = z.object({
  callId: idSchema,
  candidate: z
    .object({
      candidate: z.string().max(MAX_CANDIDATE_LENGTH),
      sdpMid: z.string().max(100).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(255).nullable().optional(),
      usernameFragment: z.string().max(100).nullable().optional(),
    })
    .nullable(),
});

export type SdpSignal = z.infer<typeof sdpSignal>;
export type CandidateSignal = z.infer<typeof candidateSignal>;
