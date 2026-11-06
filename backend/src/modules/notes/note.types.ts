import type { AgentProfile } from "@shared/ports/directory.js";
import type { InternalNote, NoteMention } from "../../../prisma/generated/prisma/client.js";

export type NoteRow = InternalNote & { noteMentions: NoteMention[] };

/** An internal note. Staff only: it is never part of a message, so no customer-facing API can return it. */
export interface NoteDto {
  id: string;
  conversationId: string;
  authorAgentId: string;
  /** Name and avatar from Backend 1; null when Backend 1 could not be reached. */
  author: AgentProfile | null;
  content: string;
  /** Backend 1 ids of the agents mentioned in the note. */
  mentionedAgentIds: string[];
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
  /** What the caller may do with this note right now. */
  permissions: { canEdit: boolean; canDelete: boolean };
}
