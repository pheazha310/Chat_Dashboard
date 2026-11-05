import type { ConversationAssignment } from "../../../prisma/generated/prisma/client.js";

export type AssignmentRow = ConversationAssignment;

export interface AssignmentDto {
  id: string;
  conversationId: string;
  agentId: string;
  assignedBy: string | null;
  type: string;
  action: string;
  note: string | null;
  assignedAt: string;
  endedAt: string | null;
  endedBy: string | null;
}

/** The conversation state an ownership change is decided from, and conditionally updated against. */
export interface ConversationState {
  id: string;
  status: string;
  handoffStatus: string;
  assignedAgentId: string | null;
  isArchived: boolean;
}
