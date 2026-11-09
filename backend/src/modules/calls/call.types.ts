export type CallType = "AUDIO" | "VIDEO";
/** INITIATING and FAILED exist in the schema but nothing sets them yet (a call starts RINGING). */
export type CallStatus = "INITIATING" | "RINGING" | "ACTIVE" | "ENDED" | "DECLINED" | "MISSED" | "CANCELLED" | "FAILED";
export type PartyType = "AGENT" | "CUSTOMER";

/** Who is acting. Customers cannot use the dashboard API or socket; their entry points are service methods. */
export type CallActor =
  { type: "AGENT"; auth: import("@shared/auth/auth.types.js").AuthContext } | { type: "CUSTOMER"; id: string };

export interface CallParticipantDto {
  type: PartyType;
  id: string;
  joinedAt: string | null;
  leftAt: string | null;
}

export interface CallDto {
  id: string;
  conversationId: string;
  callType: CallType;
  status: CallStatus;
  initiatedBy: { type: PartyType; id: string };
  participants: CallParticipantDto[];
  startedAt: string | null;
  endedAt: string | null;
  /** Seconds between answer and end; null until the call was answered and ended. */
  durationSeconds: number | null;
  createdAt: string;
  /** What the caller may do now (always false for the customer side, which uses its own channel). */
  permissions: { canAccept: boolean; canDecline: boolean; canCancel: boolean; canEnd: boolean };
}

export type SignalKind = "offer" | "answer" | "ice_candidate";

export interface CallOptions {
  /** A ringing call nobody answered becomes MISSED after this long. */
  ringTimeoutMs: number;
  /** A call still ACTIVE after this long is ended by the job (nobody ended it, e.g. both sides lost connection). */
  maxDurationMs: number;
}

export const DEFAULT_CALL_OPTIONS: CallOptions = { ringTimeoutMs: 45_000, maxDurationMs: 4 * 60 * 60_000 };

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** STUN/TURN settings from the environment. TURN credentials are never logged or stored. */
export interface IceConfig {
  stunUrls: string[];
  turnUrls: string[];
  /** coturn `use-auth-secret`: short-lived credentials are derived from it per caller. Preferred. */
  turnSecret?: string | undefined;
  turnTtlSeconds: number;
  /** A fixed username and password, when the TURN server has no shared secret. */
  turnUsername?: string | undefined;
  turnCredential?: string | undefined;
}
