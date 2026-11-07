import type { WebSocket } from "ws";
import { isSupervisor, type AuthContext } from "@shared/auth/auth.types.js";
import type { Audience, BusEvent, ConversationVisibility } from "@shared/events/event-bus.js";
import { canView } from "@shared/policy/conversation-access.js";

/** One WebSocket and what we know about it. `auth` is set once the token was verified. */
export interface Connection {
  id: string;
  socket: WebSocket;
  auth?: AuthContext;
  /** Conversations this socket is typing in, with the timer that ends the indicator if the client goes quiet. */
  typing: Map<string, NodeJS.Timeout>;
  /** Frames are handled one at a time, in arrival order. */
  queue: Promise<void>;
  /** Conversations this socket joined (`room.join`). A customer socket only receives events of joined rooms. */
  rooms: Set<string>;
}

export const isCustomer = (auth: AuthContext) => auth.role === "CUSTOMER";

/** The only events a customer socket may receive. Everything else (notes, tags, assignments, presence...) is staff-only. */
const CUSTOMER_EVENTS = new Set([
  "message.new",
  "message.status",
  "message.updated",
  "message.deleted",
  "attachment.uploaded",
  "attachment.deleted",
  "typing",
]);

type Loose = { [key: string]: unknown };
const asObject = (value: unknown): Loose => (typeof value === "object" && value !== null ? (value as Loose) : {});

/** The conversation an event is about, wherever its payload carries the id. */
function conversationOf(payload: unknown): string | undefined {
  const p = asObject(payload);
  const nested = asObject(p.message).conversationId ?? asObject(p.attachment).conversationId;
  const id = p.conversationId ?? nested;
  return typeof id === "string" ? id : undefined;
}

/**
 * What a customer socket receives for an event, or null. Rules: only whitelisted events, only the customer's own
 * conversation, only after `room.join`, and never internal data: SYSTEM messages are dropped, `metadata` is removed
 * and typing does not reveal the agent's id.
 */
export function customerView(event: BusEvent, connection: Connection): { type: string; payload: unknown } | null {
  const { auth } = connection;
  const { audience } = event;
  if (!auth || !CUSTOMER_EVENTS.has(event.type) || audience.kind !== "conversation") return null;
  if (!audience.customerId || audience.customerId !== auth.userId) return null;
  const conversationId = conversationOf(event.payload);
  if (!conversationId || !connection.rooms.has(conversationId)) return null;

  const payload = asObject(event.payload);
  if (event.type === "message.new" || event.type === "message.updated") {
    const message = asObject(payload.message);
    if (message.senderType === "SYSTEM") return null;
    return { type: event.type, payload: { ...payload, message: { ...message, metadata: null } } };
  }
  if (event.type === "typing") {
    // Only the agent's typing matters to the customer, and their id stays internal.
    if (payload.side !== "agent") return null;
    const { userId: _internal, ...rest } = payload;
    return { type: event.type, payload: rest };
  }
  return { type: event.type, payload: event.payload };
}

const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/**
 * Whether a socket may receive an event. Conversation events follow the same visibility rule as REST (`canView`),
 * evaluated against the conversation state carried in the event, so nothing leaks to agents who could not open it.
 */
export function canReceive(audience: Audience, auth: AuthContext): boolean {
  if (isCustomer(auth)) return false; // customers are served by `customerView`
  const userId = auth.userId.toString();
  switch (audience.kind) {
    case "dashboard":
      return true;
    case "users":
      return audience.userIds.includes(userId);
    case "conversation":
      return audience.alsoUserIds.includes(userId) || mayView(audience, auth);
    case "not_conversation":
      return !mayView(audience, auth);
  }
}

function mayView(visibility: ConversationVisibility, auth: AuthContext): boolean {
  return (
    isSupervisor(auth) ||
    canView(
      auth,
      {
        status: "OPEN",
        isArchived: false,
        handoffStatus: visibility.handoffStatus,
        assignedAgentId: visibility.assignedAgentId === null ? null : visibility.assignedAgentId,
      },
      visibility.viewerIds.includes(auth.userId.toString()),
    )
  );
}

export const frame = (type: string, payload: unknown) => JSON.stringify({ type, payload });

/** Sends to one socket; a client that stopped reading is dropped instead of buffering without limit. */
export function sendTo(connection: Connection, type: string, payload: unknown) {
  const { socket } = connection;
  if (socket.readyState !== socket.OPEN) return;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return void socket.terminate();
  socket.send(frame(type, payload));
}

/** The authenticated sockets of this API instance. Events from the bus are filtered per socket here. */
export class ConnectionRegistry {
  private readonly connections = new Map<string, Connection>();

  add(connection: Connection) {
    this.connections.set(connection.id, connection);
  }

  remove(connection: Connection) {
    this.connections.delete(connection.id);
  }

  get size() {
    return this.connections.size;
  }

  all(): Iterable<Connection> {
    return this.connections.values();
  }

  /** Delivers a bus event to every authenticated socket that may receive it, except the origin socket. */
  deliver(event: BusEvent) {
    for (const connection of this.connections.values()) {
      if (!connection.auth || connection.id === event.except) continue;
      if (isCustomer(connection.auth)) {
        const view = customerView(event, connection);
        if (view) sendTo(connection, view.type, view.payload);
      } else if (canReceive(event.audience, connection.auth)) {
        sendTo(connection, event.type, event.payload);
      }
    }
  }
}
