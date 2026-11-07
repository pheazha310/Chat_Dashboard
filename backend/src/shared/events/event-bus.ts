/**
 * Who may receive a realtime event. The gateway evaluates this per socket, so an event is never delivered to an
 * agent who could not open the conversation over REST (same rules as `canView`).
 */
export type Audience =
  /** Every authenticated dashboard socket (e.g. presence changes). */
  | { kind: "dashboard" }
  /** Only the listed users, on all of their sessions. */
  | { kind: "users"; userIds: string[] }
  /** Whoever may see a conversation in this state, plus users who just lost access and must be told. */
  | ({ kind: "conversation"; alsoUserIds: string[] } & ConversationVisibility)
  /** The opposite: sockets that may NOT see a conversation in this state (told that it left their inbox). */
  | ({ kind: "not_conversation" } & ConversationVisibility);

/** The conversation fields the visibility rule depends on (see `canView`). */
export interface ConversationVisibility {
  handoffStatus: string;
  assignedAgentId: string | null;
  viewerIds: string[];
  /** The customer the conversation belongs to. Customer sockets receive only their own conversations' events. */
  customerId?: string | null;
}

export interface BusEvent {
  type: string;
  payload: unknown;
  audience: Audience;
  /** Connection id to skip (the socket that already got a direct reply). */
  except?: string;
}

/** Fan-out between API instances. Implementations: Redis (production) and in-memory (one process, tests). */
export interface EventBus {
  publish(event: BusEvent): Promise<void>;
  subscribe(handler: (event: BusEvent) => void): () => void;
  close(): Promise<void>;
}
