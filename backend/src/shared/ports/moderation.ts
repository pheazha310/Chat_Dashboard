/**
 * What the customer-facing code paths (a customer's message, a customer's call) ask the moderation module before
 * acting. Kept as a port so messages and calls never import it.
 */
export interface CustomerGuard {
  /** Whether the customer is currently blocked. */
  isBlocked(customerId: string): Promise<boolean>;
  /** Ids of the active blocked keywords that occur in `text` (ignoring case). Empty when none match. */
  matchedKeywords(text: string): Promise<string[]>;
}

/** Lets the moderation module check that a reported message really belongs to the conversation. */
export interface MessageLookup {
  existsInConversation(conversationId: string, messageId: string): Promise<boolean>;
}
