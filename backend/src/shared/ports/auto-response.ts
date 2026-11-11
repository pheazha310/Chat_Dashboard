/** What the conversation and message services tell the automatic replies: something happened that may deserve one. */
export interface AutoResponder {
  /** A customer opened a new conversation. */
  conversationStarted(conversationId: string): Promise<void>;
  /** A customer sent a message in a conversation. */
  customerMessaged(conversationId: string): Promise<void>;
}

/** Lets the automatic replies post a message the customer can see, without touching the messages module. */
export interface AutomaticMessagePort {
  /** Stores an automatic reply and returns its id, or null when the conversation does not exist. */
  postAutomatic(conversationId: string, text: string, metadata: Record<string, unknown>): Promise<string | null>;
}
