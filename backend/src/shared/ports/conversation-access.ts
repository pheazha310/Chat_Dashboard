import type { AuthContext } from "@shared/auth/auth.types.js";
import type { ConversationSummaryDto } from "@modules/conversations/index.js";
import type { PolicyInput } from "@shared/policy/conversation-access.js";

export interface AccessibleConversationState extends PolicyInput {
  id: string;
  customerId: string | null;
}

/** Lets other modules ask "may this caller see this conversation?" without touching its repository. */
export interface ConversationAccess {
  /** Resolves with the conversation's state, or throws NotFoundError (also when it is hidden from the caller). */
  requireVisible(auth: AuthContext, conversationId: string): Promise<AccessibleConversationState>;
}

/** Batch lookup for views that list several conversations (workspace tabs). */
export interface ConversationSummaries {
  /** Summaries (with the caller's unread count) of the listed conversations the caller may see; hidden ones are omitted. */
  visibleSummaries(auth: AuthContext, conversationIds: string[]): Promise<Map<string, ConversationSummaryDto>>;
}
