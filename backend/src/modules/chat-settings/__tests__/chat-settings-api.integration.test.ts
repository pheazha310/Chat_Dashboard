import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "../../../__tests__/support/container.js";
import { uid } from "../../../__tests__/support/ids.js";

/** Chat settings over real HTTP and PostgreSQL. Needs TEST_DATABASE_URL. */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const agent1 = `dev:${uid(1)}:AGENT`;
const agent2 = `dev:${uid(2)}:AGENT`;
const customer = `dev:${uid(100)}:CUSTOMER`;

describe.skipIf(!url)("chat settings over HTTP", () => {
  let server: Server;
  let base: string;
  let db: typeof import("@config/database.js").prisma;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    process.env.AUTH_MODE = "dev";
    process.env.EVENT_BUS = "memory";
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    const { app } = await import("../../../app.js");
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/admin`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE user_chat_settings`;
  });

  const call = async (token: string | null, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}/agents/me/chat-settings`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };

  it("returns defaults without creating a row", async () => {
    const response = await call(agent1);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      typingSoundEnabled: true,
      notificationSoundEnabled: true,
      aiSuggestionsEnabled: true,
      aiSummariesEnabled: true,
      autoAssignEnabled: false,
    });
    expect(await db.userChatSetting.count()).toBe(0);
  });

  it("saves only the given switches and keeps them for the next read", async () => {
    const patched = await call(agent1, "PATCH", { typingSoundEnabled: false, autoAssignEnabled: true });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({
      typingSoundEnabled: false,
      autoAssignEnabled: true,
      aiSummariesEnabled: true,
    });

    await call(agent1, "PATCH", { aiSummariesEnabled: false });
    expect((await call(agent1)).body.data).toEqual({
      typingSoundEnabled: false,
      notificationSoundEnabled: true,
      aiSuggestionsEnabled: true,
      aiSummariesEnabled: false,
      autoAssignEnabled: true,
    });
    expect(await db.userChatSetting.count()).toBe(1);
  });

  it("keeps every agent's settings separate, and the caller cannot name someone else", async () => {
    await call(agent1, "PATCH", { typingSoundEnabled: false });
    expect((await call(agent2)).body.data.typingSoundEnabled).toBe(true);

    const attempt = await call(agent2, "PATCH", { typingSoundEnabled: false, userId: uid(1) });
    expect(attempt.status).toBe(400);
    expect(await db.userChatSetting.count()).toBe(1);
  });

  it("handles simultaneous first saves of different switches: one row, both changes kept", async () => {
    const results = await Promise.all([
      call(agent1, "PATCH", { typingSoundEnabled: false }),
      call(agent1, "PATCH", { aiSuggestionsEnabled: false }),
      call(agent1, "PATCH", { autoAssignEnabled: true }),
      call(agent1, "PATCH", { notificationSoundEnabled: false }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await db.userChatSetting.count()).toBe(1);
    expect((await call(agent1)).body.data).toEqual({
      typingSoundEnabled: false,
      notificationSoundEnabled: false,
      aiSuggestionsEnabled: false,
      aiSummariesEnabled: true,
      autoAssignEnabled: true,
    });
  });

  it("validates the body", async () => {
    expect((await call(agent1, "PATCH", {})).status).toBe(400);
    expect((await call(agent1, "PATCH", { typingSoundEnabled: "no" })).status).toBe(400);
    expect((await call(agent1, "PATCH", { somethingElse: true })).status).toBe(400);
    expect(await db.userChatSetting.count()).toBe(0);
  });

  it("requires a dashboard login", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call(null, "PATCH", { typingSoundEnabled: false })).status).toBe(401);
    expect((await call(customer)).status).toBe(403);
    expect((await call(customer, "PATCH", { typingSoundEnabled: false })).status).toBe(403);
  });
});
