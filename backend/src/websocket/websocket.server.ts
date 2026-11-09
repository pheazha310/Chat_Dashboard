import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { env } from "@config/env.js";
import { logger } from "@config/logger.js";
import type { AuthClient } from "@shared/auth/auth.types.js";
import type { Container } from "../container.js";
import { AUTH_TIMEOUT_MS, CLOSE, MAX_FRAME_BYTES } from "./websocket.events.js";
import { WebSocketHandler } from "./websocket.handler.js";
import { ConnectionRegistry, sendTo, type Connection } from "./websocket.rooms.js";

const HEARTBEAT_MS = 30_000;

export interface GatewayOptions {
  /** Origins allowed to open a browser WebSocket. Clients without an Origin header (servers, tests) are accepted. */
  allowedOrigins?: string[];
  heartbeatMs?: number;
  authTimeoutMs?: number;
  typingTtlMs?: number;
}

/**
 * Transport for /ws: accepts sockets, requires an `auth` frame, hands frames to the handler and relays events from
 * the bus to the sockets allowed to see them. No business rules live here.
 */
export function attachWebSocketServer(
  server: Server,
  services: Container,
  authClient: AuthClient,
  options: GatewayOptions = {},
) {
  const allowedOrigins = options.allowedOrigins ?? env.CORS_ORIGIN.split(",");
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: MAX_FRAME_BYTES,
    verifyClient: ({ origin }: { origin?: string }) => !origin || allowedOrigins.includes(origin),
  });

  const registry = new ConnectionRegistry();
  const handler = new WebSocketHandler(services, authClient, registry, options.typingTtlMs);
  const unsubscribe = services.bus.subscribe((event) => registry.deliver(event));

  const alive = new WeakSet<WebSocket>();
  wss.on("connection", (socket) => {
    const connection: Connection = {
      id: randomUUID(),
      socket,
      typing: new Map(),
      queue: Promise.resolve(),
      rooms: new Set(),
    };
    registry.add(connection);
    alive.add(socket);

    const authTimeout = options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
    const authTimer = setTimeout(() => {
      if (!connection.auth) socket.close(CLOSE.unauthorized, "auth timeout");
    }, authTimeout);
    authTimer.unref();

    sendTo(connection, "connection.established", { connectionId: connection.id, authTimeoutMs: authTimeout });

    socket.on("pong", () => alive.add(socket));
    socket.on("message", (data, isBinary) => {
      if (isBinary) return void socket.close(CLOSE.tooLarge, "binary frames are not supported");
      handler.receive(connection, data.toString());
    });
    socket.on("error", (err) => logger.warn({ err }, "socket error"));
    socket.on("close", () => {
      clearTimeout(authTimer);
      // Queued after any frame still being handled, so a late auth cannot leave a ghost presence entry.
      connection.queue = connection.queue
        .then(() => handler.closed(connection))
        .catch((err: unknown) => {
          logger.warn({ err }, "socket cleanup failed");
        });
    });
  });

  // Drop connections that missed the previous heartbeat, and keep live agents counted as online.
  const heartbeat = setInterval(() => {
    for (const connection of registry.all()) {
      const { socket, auth } = connection;
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
      if (auth && auth.role !== "CUSTOMER") void services.presence.heartbeat(auth, connection.id);
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS);
  heartbeat.unref();

  wss.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });

  return wss;
}
