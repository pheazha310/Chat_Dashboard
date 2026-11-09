import type { AuthContext } from "@shared/auth/auth.types.js";
import type { ConversationListQuery, ConversationSummaryDto } from "@modules/conversations/index.js";

/** A customer as the caller may see it: restricted fields are null and named in `restricted`. */
export interface CustomerDto {
  id: string;
  name: string;
  avatarUrl: string | null;
  blacklisted: boolean | null;
  email: string | null;
  phone: string | null;
  nationalId: string | null;
  occupation: string | null;
  salary: string | null;
  /** Fields hidden from this caller. */
  restricted: string[];
  /** Where Backend 1 data came from; `dev-stub` means synthetic placeholder data. */
  source: string;
}

export interface ParticipantDto {
  participantType: string;
  participantId: string | null;
  role: string;
  joinedAt: string;
  leftAt: string | null;
  /** From Backend 1; null for the AI assistant or when Backend 1 could not be reached. */
  profile: { name: string; avatarUrl: string | null } | null;
}

/** The part of the conversation service this module uses. */
export interface ConversationLister {
  list(
    auth: AuthContext,
    query: ConversationListQuery,
  ): Promise<{
    items: ConversationSummaryDto[];
    meta: { total: number; page: number; size: number; totalPages: number };
  }>;
}
