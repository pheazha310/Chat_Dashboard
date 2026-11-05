import { ZodError } from "zod";
import { logger } from "@config/logger.js";
import type { AuthClient, AuthContext } from "@shared/auth/auth.types.js";
import { AppError } from "@shared/errors/AppError.js";
import { idToString } from "@shared/utils/ids.js";
import type { Container } from "../container.js";
import { authenticateSocket } from "./websocket.auth.js";
import {
  CLOSE,
  clientEvents,
  isClientEvent,
  SYNC_INBOX_SIZE,
  SYNC_LATEST_FOR_SELECTED,
  SYNC_MESSAGES_PER_CONVERSATION,
  TYPING_TTL_MS,
  type ClientEventName,
  type ClientPayload,
} from "./websocket.events.js";
import { sendTo, type Connection, type ConnectionRegistry } from "./websocket.rooms.js";

type Context = { connection: Connection; auth: AuthContext };
type Handlers = { [K in ClientEventName]?: (context: Context, payload: ClientPayload<K>) => Promise<void> };

const toError = (error: unknown): { code: string; message: string } => {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  if (error instanceof ZodError) return { code: "BAD_REQUEST", message: "Validation failed" };
  logger.error({ err: error }, "unhandled websocket error");
  return { code: "INTERNAL_SERVER_ERROR", message: "Internal server error" };
};

/**
 * WebSocket handlers play the controller role: validate the frame, call the same service the REST route calls, reply.
 * They hold no business rules, so a rule enforced over REST is enforced identically here.
 */
export class WebSocketHandler {
  private readonly handlers: Handlers;

  constructor(
    private readonly services: Container,
    private readonly authClient: AuthClient,
    private readonly registry: ConnectionRegistry,
    private readonly typingTtlMs: number = TYPING_TTL_MS,
  ) {
    const { messages, conversations, assignments, presence, notifications } = services;
    this.handlers = {
      "sync.request": (context, payload) => this.sync(context, payload),
      "message.send": async ({ connection, auth }, { conversationId, ...input }) => {
        const { message, created } = await messages.send(auth, conversationId, input, connection.id);
        sendTo(connection, "message.ack", { clientId: message.clientId, created, message });
      },
      "message.delivered": async ({ auth }, p) =>
        void (await messages.markDelivered(auth, p.conversationId, p.messageId)),
      "conversation.read": async ({ auth }, p) => void (await messages.markRead(auth, p.conversationId, p.messageId)),
      "conversation.unread": async ({ auth }, p) => void (await messages.markUnread(auth, p.conversationId)),
      "conversation.takeover": async ({ auth }, p) => void (await assignments.assign(auth, p.conversationId, {})),
      "conversation.assign": async ({ auth }, { conversationId, ...input }) =>
        void (await assignments.assign(auth, conversationId, input)),
      "conversation.transfer": async ({ auth }, { conversationId, ...input }) =>
        void (await assignments.transfer(auth, conversationId, input)),
      "conversation.release": async ({ auth }, { conversationId, ...input }) =>
        void (await assignments.unassign(auth, conversationId, input)),
      "conversation.set_status": async ({ auth }, p) =>
        void (await conversations.changeStatus(auth, p.conversationId, p.status)),
      "typing.start": (context, p) => this.typing(context, p.conversationId, true),
      "typing.stop": (context, p) => this.typing(context, p.conversationId, false),
      "notification.read": async ({ auth }, p) =>
        void (p.notificationId === undefined
          ? await notifications.markAllRead(auth)
          : await notifications.markRead(auth, p.notificationId)),
      "presence.set": async ({ auth }, p) => void (await presence.setStatus(auth, p)),
    };
  }

  /** Entry point for every raw frame. Frames of one socket are processed strictly in order. */
  receive(connection: Connection, raw: string) {
    connection.queue = connection.queue
      .then(() => this.process(connection, raw))
      .catch((error: unknown) => {
        logger.error({ err: error }, "websocket frame handler crashed");
      });
  }

  /** Runs when a socket closes: ends its typing indicators and, for the agent's last socket, marks them offline. */
  async closed(connection: Connection) {
    this.registry.remove(connection);
    const { auth } = connection;
    if (!auth) return;
    for (const [conversation, timer] of connection.typing) {
      clearTimeout(timer);
      await this.publishTyping(connection, auth, BigInt(conversation), false);
    }
    connection.typing.clear();
    await this.services.presence.disconnect(auth, connection.id);
  }

  private async process(connection: Connection, raw: string) {
    let type: string;
    let payload: unknown;
    try {
      const frame: unknown = JSON.parse(raw);
      if (typeof frame !== "object" || frame === null) throw new Error("not an object");
      ({ type, payload } = frame as { type: string; payload: unknown });
      if (typeof type !== "string") throw new Error("missing type");
    } catch {
      return void sendTo(connection, "error", { code: "BAD_REQUEST", message: "Frames must be JSON {type, payload}" });
    }

    if (type === "auth") return this.authenticate(connection, payload);
    if (!connection.auth) {
      sendTo(connection, "error", { code: "UNAUTHORIZED", message: "Send an auth frame first", event: type });
      return void connection.socket.close(CLOSE.unauthorized, "unauthenticated");
    }
    if (!isClientEvent(type)) {
      return void sendTo(connection, "error", {
        code: "UNKNOWN_EVENT",
        message: `Unknown event: ${type}`,
        event: type,
      });
    }

    const context: Context = { connection, auth: connection.auth };
    try {
      const parsed = clientEvents[type].parse(payload ?? {});
      const handler = this.handlers[type] as ((c: Context, p: unknown) => Promise<void>) | undefined;
      if (!handler) throw new AppError(400, "UNKNOWN_EVENT", `Unsupported event: ${type}`);
      await handler(context, parsed);
    } catch (error) {
      this.reportFailure(connection, type, payload, error);
    }
  }

  private async authenticate(connection: Connection, payload: unknown) {
    if (connection.auth) {
      return void sendTo(connection, "error", { code: "CONFLICT", message: "Already authenticated", event: "auth" });
    }
    try {
      const { token, reconnect } = clientEvents.auth.parse(payload);
      const auth = await authenticateSocket(this.authClient, token);
      connection.auth = auth;
      await this.services.presence.connect(auth, connection.id);
      sendTo(connection, reconnect ? "connection.reconnected" : "connection.authenticated", {
        connectionId: connection.id,
        userId: idToString(auth.userId),
        role: auth.role,
      });
    } catch (error) {
      const { code, message } = toError(error);
      sendTo(connection, "error", { code, message, event: "auth" });
      connection.socket.close(code === "FORBIDDEN" ? CLOSE.forbidden : CLOSE.unauthorized, code.toLowerCase());
    }
  }

  private reportFailure(connection: Connection, type: string, payload: unknown, error: unknown) {
    const { code, message } = toError(error);
    if (type === "message.send") {
      // A failed send names the clientId so the client can mark exactly that optimistic message as failed.
      const raw = (payload ?? {}) as Record<string, unknown>;
      sendTo(connection, "message.failed", {
        conversationId: typeof raw.conversationId === "string" ? raw.conversationId : null,
        clientId: typeof raw.clientId === "string" ? raw.clientId : null,
        code,
        message,
      });
      return;
    }
    const raw = (payload ?? {}) as Record<string, unknown>;
    sendTo(connection, "error", {
      code,
      message,
      event: type,
      conversationId: typeof raw.conversationId === "string" ? raw.conversationId : undefined,
    });
  }

  /**
   * Inbox plus what the client missed. `cursors` maps a conversation to the last sequence number the client holds:
   * the reply has everything after it. Conversations with more than one page of missed messages are listed in
   * `incomplete`; the client pages those over REST (`GET /conversations/:id/messages?after=`).
   */
  private async sync({ connection, auth }: Context, payload: ClientPayload<"sync.request">) {
    const { conversations, messages, presence, notifications } = this.services;
    const inbox = await conversations.list(auth, { filter: "all", page: 1, size: SYNC_INBOX_SIZE });

    const wanted = new Map<string, bigint | undefined>();
    for (const [id, cursor] of Object.entries(payload.cursors ?? {})) wanted.set(id, BigInt(cursor));
    if (payload.selectedConversationId !== undefined) {
      const selected = idToString(payload.selectedConversationId);
      if (!wanted.has(selected)) wanted.set(selected, undefined);
    }

    const missed: Record<string, unknown[]> = {};
    const incomplete: string[] = [];
    for (const [id, after] of wanted) {
      try {
        const page = await messages.history(
          auth,
          BigInt(id),
          after === undefined ? { limit: SYNC_LATEST_FOR_SELECTED } : { limit: SYNC_MESSAGES_PER_CONVERSATION, after },
        );
        missed[id] = page.items;
        if (after !== undefined && page.meta.hasMore) incomplete.push(id);
      } catch (error) {
        // A conversation the agent lost access to (or that no longer exists) is simply absent from the reply.
        if (!(error instanceof AppError)) throw error;
      }
    }

    const online = await presence.snapshot().catch(() => []);
    const unreadNotifications = (await notifications.unreadCount(auth)).unreadCount;
    sendTo(connection, "sync", {
      conversations: inbox.items,
      meta: inbox.meta,
      messages: missed,
      incomplete,
      presence: online,
      notifications: { unreadCount: unreadNotifications },
      serverTime: new Date().toISOString(),
    });
  }

  private async typing({ connection, auth }: Context, conversationId: bigint, active: boolean) {
    const key = conversationId.toString();
    const existing = connection.typing.get(key);
    if (!active) {
      if (!existing) return;
      clearTimeout(existing);
      connection.typing.delete(key);
      return this.publishTyping(connection, auth, conversationId, false);
    }

    await this.services.conversations.assertCanType(auth, conversationId);
    if (existing) clearTimeout(existing);
    else await this.publishTyping(connection, auth, conversationId, true);
    // The indicator ends by itself if the client stops sending (closed tab, lost connection, forgot to send stop).
    const timer = setTimeout(() => {
      connection.typing.delete(key);
      void this.publishTyping(connection, auth, conversationId, false);
    }, this.typingTtlMs);
    timer.unref();
    connection.typing.set(key, timer);
  }

  private async publishTyping(connection: Connection, auth: AuthContext, conversationId: bigint, active: boolean) {
    try {
      await this.services.realtime.typing(conversationId, auth.userId, active, connection.id);
    } catch (error) {
      logger.warn({ err: error }, "typing event failed");
    }
  }
}
