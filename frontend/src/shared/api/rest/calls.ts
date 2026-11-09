import { apiRequest } from "./client";

export type CallStatus = "INITIATING" | "RINGING" | "ACTIVE" | "ENDED" | "DECLINED" | "MISSED" | "CANCELLED" | "FAILED";

export type Call = {
  id: string;
  conversationId: string;
  callType: "AUDIO" | "VIDEO";
  status: CallStatus;
  initiatedBy: { type: "AGENT" | "CUSTOMER"; id: string };
  participants: { type: "AGENT" | "CUSTOMER"; id: string; joinedAt: string | null; leftAt: string | null }[];
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  createdAt: string;
};

export type CallConfig = {
  iceServers: { urls: string[]; username?: string; credential?: string }[];
  ringTimeoutSeconds: number;
};

/** Call control (docs/api-calls.md). Session descriptions and ICE candidates go over the WebSocket instead. */
export const getCallConfig = async () => (await apiRequest<CallConfig>("/calls/config")).data;

export const startCallRequest = async (conversationId: string, callType: "AUDIO" | "VIDEO" = "AUDIO") =>
  (await apiRequest<Call>(`/conversations/${conversationId}/calls`, { method: "POST", body: { callType } })).data;

const action = (name: "accept" | "decline" | "cancel" | "end") => async (callId: string) =>
  (await apiRequest<Call>(`/calls/${callId}/${name}`, { method: "POST" })).data;

export const acceptCallRequest = action("accept");
export const declineCallRequest = action("decline");
export const cancelCallRequest = action("cancel");
export const endCallRequest = action("end");
