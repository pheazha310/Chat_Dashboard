/** Lets other modules post SYSTEM messages (takeover, transfer, status changes) without touching the messages module. */
export interface SystemMessagePort {
  post(conversationId: string, text: string, metadata?: Record<string, unknown>): Promise<void>;
}
