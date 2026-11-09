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

/**
 * For the customer channel (not built yet): resolves a conversation for the customer it belongs to. Customers have no
 * AuthContext, so this is separate from `requireVisible`. Throws NotFoundError when the conversation is not theirs.
 */
export interface CustomerConversationAccess {
  requireForCustomer(customerId: string, conversationId: string): Promise<AccessibleConversationState>;
}

/** Batch lookup for views that list several conversations (workspace tabs). */
export interface ConversationSummaries {
  /** Summaries (with the caller's unread count) of the listed conversations the caller may see; hidden ones are omitted. */
  visibleSummaries(auth: AuthContext, conversationIds: string[]): Promise<Map<string, ConversationSummaryDto>>;
}
