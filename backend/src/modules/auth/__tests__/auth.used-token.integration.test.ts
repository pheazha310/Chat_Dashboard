import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "../../../__tests__/support/container.js";

/** The single-use hand-off `jti` store against real PostgreSQL. Needs TEST_DATABASE_URL. */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

describe.skipIf(!url)("PrismaUsedTokenIds", () => {
  let db: typeof import("@config/database.js").prisma;
  let store: import("../auth.used-token.repository.js").PrismaUsedTokenIds;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    store = new (await import("../auth.used-token.repository.js")).PrismaUsedTokenIds(db);
  });
  beforeEach(async () => {
    await db.losHandoffToken.deleteMany();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("accepts an id once and refuses it again", async () => {
    expect(await store.claim("jti-1", 60_000)).toBe(true);
    expect(await store.claim("jti-1", 60_000)).toBe(false);
    expect(await store.claim("jti-2", 60_000)).toBe(true);
  });

  it("lets exactly one of many concurrent claims win", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => store.claim("jti-race", 60_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("forgets an id once its token has expired", async () => {
    await db.losHandoffToken.create({ data: { jti: "old", expiresAt: new Date(Date.now() - 1000) } });
    expect(await store.claim("old", 60_000)).toBe(true);
  });
});
