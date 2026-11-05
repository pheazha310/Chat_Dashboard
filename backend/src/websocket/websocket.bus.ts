import { Redis } from "ioredis";
import { logger } from "@config/logger.js";
import type { BusEvent, EventBus } from "@shared/events/event-bus.js";
import { withTimeout } from "@shared/utils/with-timeout.js";

// Every API instance publishes chat events to this channel and relays what it receives to its own sockets,
// so the gateway scales past one process.
export const EVENTS_CHANNEL = "chat:events";
const PUBLISH_TIMEOUT_MS = 2_000;
const CLOSE_TIMEOUT_MS = 1_000;

/** One process only: no network, used in tests and single-instance development. */
export class MemoryEventBus implements EventBus {
  private handlers = new Set<(event: BusEvent) => void>();

  async publish(event: BusEvent) {
    // Round-trip through JSON so tests see exactly what Redis would deliver.
    const copy = JSON.parse(JSON.stringify(event)) as BusEvent;
    for (const handler of this.handlers) handler(copy);
  }

  subscribe(handler: (event: BusEvent) => void) {
    this.handlers.add(handler);
    return () => void this.handlers.delete(handler);
  }

  async close() {
    this.handlers.clear();
  }
}

const isBusEvent = (value: unknown): value is BusEvent =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as BusEvent).type === "string" &&
  typeof (value as BusEvent).audience === "object" &&
  (value as BusEvent).audience !== null;

export class RedisEventBus implements EventBus {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly handlers = new Set<(event: BusEvent) => void>();
  private subscribed = false;

  constructor(url: string) {
    // Connections are created lazily so importing this module never opens sockets.
    this.publisher = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true });
    this.subscriber = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true });
    this.subscriber.on("message", (_channel, raw) => {
      let event: unknown;
      try {
        event = JSON.parse(raw);
      } catch {
        logger.warn("dropped a malformed event from the bus");
        return;
      }
      if (!isBusEvent(event)) return void logger.warn("dropped an invalid event from the bus");
      for (const handler of this.handlers) handler(event);
    });
    for (const client of [this.publisher, this.subscriber]) client.on("error", (err) => logger.warn({ err }, "redis"));
  }

  async publish(event: BusEvent) {
    // ioredis queues commands while disconnected; fail fast so a Redis outage cannot stall a request.
    await withTimeout(
      this.publisher.publish(EVENTS_CHANNEL, JSON.stringify(event)),
      PUBLISH_TIMEOUT_MS,
      "event bus publish",
    );
  }

  subscribe(handler: (event: BusEvent) => void) {
    this.handlers.add(handler);
    if (!this.subscribed) {
      this.subscribed = true;
      void this.subscriber.subscribe(EVENTS_CHANNEL).catch((err: unknown) => logger.warn({ err }, "subscribe failed"));
    }
    return () => void this.handlers.delete(handler);
  }

  async close() {
    this.handlers.clear();
    // quit() is queued behind unsent commands, so it never finishes when Redis is unreachable: give up and cut the line.
    await Promise.allSettled(
      [this.publisher, this.subscriber].map(async (client) => {
        try {
          await withTimeout(client.quit(), CLOSE_TIMEOUT_MS, "redis quit");
        } catch {
          client.disconnect();
        }
      }),
    );
  }
}
