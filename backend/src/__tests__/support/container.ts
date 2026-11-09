import type { AuthContext } from "@shared/auth/auth.types.js";
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
  const { LocalStorage } = await import("@shared/storage/local-storage.js");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const bus = new MemoryEventBus();
  const redis = new Redis(process.env.TEST_REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const events: BusEvent[] = [];
  bus.subscribe((event) => events.push(event));
  return {
    ...createContainer(
      bus,
      redis,
      new DevDirectory(),
      new LocalStorage(await mkdtemp(join(tmpdir(), "chat-test-storage-"))),
    ),
    db,
    redis,
    events,
    /**
     * Gives hand-made identities a chat identity, as signing in does (messages and attachments reference chat_users).
     * Tests that call services directly with `{ userId, role }` call this once for the ids they use.
     */
    identify: async (...auths: AuthContext[]) => {
      const { ChatIdentityRepository, ChatIdentityService } = await import("@modules/chat-identity/index.js");
      const identities = new ChatIdentityService(new ChatIdentityRepository(db));
      for (const auth of auths) await identities.resolve(auth);
    },
    /** Events of one type published since the last `events.length = 0`. */
    published: (type: string) => events.filter((event) => event.type === type),
  };
}
