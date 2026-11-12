import type { ClientInfo } from "./auth.types.js";

export type AuthAuditEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "LOGOUT_ALL"
  | "REFRESH_REUSE_DETECTED"
  | "SESSIONS_REVOKED"
  | "IDENTITY_LINKED"
  | "IDENTITY_UNLINKED";

/** One authentication event. Never carries a password, a token or a token hash. */
export interface AuthAuditEvent {
  event: AuthAuditEventType;
  /** CHAT: this backend's own accounts and sessions. LOS: an LOS token or LOS credentials. */
  provider: "CHAT" | "LOS";
  outcome: "SUCCESS" | "FAILURE";
  userId?: string | null;
  /** The admin who did it, for admin actions. */
  actorId?: string | null;
  attemptedUsername?: string | null;
  /** Short machine-readable cause, e.g. BAD_PASSWORD, DISABLED, LOS_UNAVAILABLE. */
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Where the events go. `record` must never throw: an audit failure must not break (or allow) a sign-in. */
export interface AuthAuditLog {
  record(event: AuthAuditEvent): Promise<void>;
}

export const NO_AUDIT: AuthAuditLog = { record: async () => {} };

const USERNAME_SHAPE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** The typed name, only when it looks like a username: a password typed into the wrong box is never stored. */
export const auditableUsername = (typed: string): string | null => {
  const name = typed.trim().toLowerCase();
  return USERNAME_SHAPE.test(name) ? name : null;
};

export const clientFields = (client: ClientInfo) => ({
  ipAddress: client.ipAddress?.slice(0, 45) ?? null,
  userAgent: client.userAgent?.slice(0, 255) ?? null,
});
