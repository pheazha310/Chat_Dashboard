export const PRESENCE_STATUSES = ["AVAILABLE", "BUSY", "AWAY", "OFFLINE"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/** Statuses an agent can choose. OFFLINE is derived: it means no open session. */
export type SelectableStatus = Exclude<PresenceStatus, "OFFLINE">;

export interface PresenceDto {
  userId: string;
  status: PresenceStatus;
}
