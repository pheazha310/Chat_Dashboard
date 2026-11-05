import type { BusEvent } from "@shared/events/event-bus.js";

/** Integration tests truncate tables: refuse to run unless we are really connected to a test database. */
export async function assertTestDatabase(db: { $queryRaw: (q: TemplateStringsArray) => Promise<unknown> }) {
  const rows = (await db.$queryRaw`SELECT current_database() AS name`) as { name: string }[];
  const name = rows[0]?.name ?? "";
  if (!/test/i.test(name)) throw new Error(`Refusing to run against database "${name}": its name must contain "test"`);
}

/**
 * The real services on a real database (TEST_DATABASE_URL) with an in-memory event bus, and a log of every event
 * published. Redis is only touched by presence (TEST_REDIS_URL, default localhost:6379).
 */
export async function createTestContainer() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL as string;
  process.env.EVENT_BUS = "memory";
  const db = (await import("@config/database.js")).prisma;
  await assertTestDatabase(db);
  const { Redis } = await import("ioredis");
  const { createContainer } = await import("../../container.js");
  const { MemoryEventBus } = await import("../../websocket/websocket.bus.js");
  const { DevDirectory } = await import("@shared/directory/dev-directory.js");

  const bus = new MemoryEventBus();
  const redis = new Redis(process.env.TEST_REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const events: BusEvent[] = [];
  bus.subscribe((event) => events.push(event));
  return {
    ...createContainer(bus, redis, new DevDirectory()),
    db,
    redis,
    events,
    /** Events of one type published since the last `events.length = 0`. */
    published: (type: string) => events.filter((event) => event.type === type),
  };
}
