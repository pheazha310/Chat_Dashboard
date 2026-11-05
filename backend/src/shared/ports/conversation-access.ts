import type { AuthContext } from "@shared/auth/auth.types.js";
import type { PolicyInput } from "@shared/policy/conversation-access.js";

export interface AccessibleConversationState extends PolicyInput {
  id: bigint;
  customerId: bigint | null;
}

/** Lets other modules ask "may this caller see this conversation?" without touching its repository. */
export interface ConversationAccess {
  /** Resolves with the conversation's state, or throws NotFoundError (also when it is hidden from the caller). */
  requireVisible(auth: AuthContext, conversationId: bigint): Promise<AccessibleConversationState>;
}
