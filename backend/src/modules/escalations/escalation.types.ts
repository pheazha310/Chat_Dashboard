export type EscalationStatus = "PENDING" | "RESOLVED" | "CANCELLED";

export interface EscalationDto {
  id: string;
  conversationId: string;
  /** Backend 1 id of the agent who escalated. */
  requestedBy: string;
  reason: string | null;
  status: EscalationStatus;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
