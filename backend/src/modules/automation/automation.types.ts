/** The team's two automatic replies. `null` until the team saves a text: nothing is sent for a trigger without one. */
export interface AutoResponsesDto {
  /** Sent when a customer writes and no agent is available. */
  awayMessage: string | null;
  /** Sent once when a customer opens a conversation. */
  firstResponse: string | null;
}

export type TrainingStatus = "PENDING" | "APPROVED";

/** One reply the team proposes for the future AI assistant. Nothing consumes approved examples yet. */
export interface TrainingExampleDto {
  id: string;
  customerMessage: string;
  suggestedReply: string;
  status: TrainingStatus;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}
