import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "../../../__tests__/support/container.js";
import { uid } from "../../../__tests__/support/ids.js";

/** Canned responses over real HTTP and PostgreSQL. Needs TEST_DATABASE_URL. */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const agent1 = `dev:${uid(1)}:AGENT`;
const agent2 = `dev:${uid(2)}:AGENT`;
const supervisor = `dev:${uid(9)}:SUPERVISOR`;
const customer = `dev:${uid(100)}:CUSTOMER`;

describe.skipIf(!url)("canned responses over HTTP", () => {
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
    await db.$executeRaw`TRUNCATE canned_responses`;
  });

  const call = async (path: string, token: string | null, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}/canned-responses${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const make = async (token: string, title: string, extra: Record<string, unknown> = {}) =>
    (await call("", token, "POST", { title, content: `${title} text`, ...extra })).body.data as { id: string };
  const titles = (response: { body: Record<string, any> }) => response.body.data.map((t: any) => t.title);

  it("creates a personal template that only its owner can see, search or open", async () => {
    const created = await call("", agent1, "POST", {
      title: "Greeting",
      content: "Hello, how can I help?",
      shortcut: "/hi",
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      scope: "PERSONAL",
      createdBy: uid(1),
      shortcut: "/hi",
      isActive: true,
      permissions: { canEdit: true },
    });
    const id = created.body.data.id;

    expect(titles(await call("", agent1))).toEqual(["Greeting"]);
    expect(titles(await call("", agent2))).toEqual([]);
    expect(titles(await call("", supervisor))).toEqual([]); // not even supervisors read personal templates
    expect((await call(`/${id}`, agent2)).status).toBe(404);
    expect((await call(`/${id}`, supervisor)).status).toBe(404);
    expect((await call(`/${id}`, agent2, "PATCH", { title: "x" })).status).toBe(404);
    expect((await call(`/${id}`, agent2, "DELETE")).status).toBe(404);
    expect((await call("?q=hello", agent2)).body.meta.total).toBe(0);
    expect((await call("?shortcut=/hi", agent2)).body.data).toEqual([]);
  });

  it("shares a template with everyone but lets only supervisors manage it", async () => {
    expect((await call("", agent1, "POST", { title: "T", content: "C", scope: "SHARED" })).status).toBe(403);
    const shared = await make(supervisor, "Refund policy", { scope: "SHARED", shortcut: "/refund" });
    await make(agent1, "Mine");

    expect(titles(await call("", agent2))).toEqual(["Refund policy"]);
    expect(titles(await call("", agent1))).toEqual(["Mine", "Refund policy"]);
    const seen = await call(`/${shared.id}`, agent2);
    expect(seen.body.data).toMatchObject({ scope: "SHARED", permissions: { canEdit: false } });
    expect((await call(`/${shared.id}`, agent2, "PATCH", { title: "x" })).status).toBe(403);
    expect((await call(`/${shared.id}`, agent2, "DELETE")).status).toBe(403);
    expect((await call(`/${shared.id}`, supervisor, "PATCH", { content: "Updated" })).body.data.content).toBe(
      "Updated",
    );
    expect(titles(await call("?scope=SHARED", agent1))).toEqual(["Refund policy"]);
    expect(titles(await call("?scope=PERSONAL", agent1))).toEqual(["Mine"]);
  });

  it("searches title, text and shortcut ignoring case, and finds a shortcut exactly", async () => {
    await make(agent1, "Greeting", { shortcut: "/hi" });
    await make(agent1, "Closing", { shortcut: "/bye" });
    await make(agent1, "Docs request", { content: "Please send your SALARY slip" });
    expect(titles(await call("?q=greet", agent1))).toEqual(["Greeting"]);
    expect(titles(await call("?q=salary", agent1))).toEqual(["Docs request"]);
    expect(titles(await call("?q=%2Fbye", agent1))).toEqual(["Closing"]);
    expect(titles(await call("?shortcut=/HI", agent1))).toEqual(["Greeting"]);
    expect((await call("?q=%25", agent1)).body.meta.total).toBe(0); // a percent sign is text, not a wildcard
    expect(titles(await call("?size=2&page=2", agent1))).toEqual(["Greeting"]);
  });

  it("deactivates instead of deleting, hides it from lists, and can bring it back", async () => {
    const id = (await make(agent1, "Old", { shortcut: "/old" })).id;
    const gone = await call(`/${id}`, agent1, "DELETE");
    expect(gone.body.data).toMatchObject({ isActive: false });
    expect((await call(`/${id}`, agent1, "DELETE")).status).toBe(200); // repeating is harmless
    expect(await db.cannedResponse.count()).toBe(1); // kept in the database
    expect(titles(await call("", agent1))).toEqual([]);
    expect(titles(await call("?includeInactive=true", agent1))).toEqual(["Old"]);
    expect(titles(await call("?includeInactive=true", agent2))).toEqual([]);
    expect((await call(`/${id}`, agent1)).body.data.isActive).toBe(false);

    expect((await call(`/${id}`, agent1, "PATCH", { isActive: true })).body.data.isActive).toBe(true);
    expect(titles(await call("", agent1))).toEqual(["Old"]);
  });

  it("hides deactivated shared templates from agents but not from supervisors", async () => {
    const id = (await make(supervisor, "Seasonal", { scope: "SHARED" })).id;
    await call(`/${id}`, supervisor, "DELETE");
    expect(titles(await call("", agent1))).toEqual([]);
    expect(titles(await call("?includeInactive=true", agent1))).toEqual([]);
    expect((await call(`/${id}`, agent1)).status).toBe(404);
    expect(titles(await call("?includeInactive=true", supervisor))).toEqual(["Seasonal"]);
    expect((await call(`/${id}`, supervisor)).status).toBe(200);
  });

  describe("shortcuts", () => {
    it("are unique per agent among personal templates, and across everyone among shared ones", async () => {
      await make(agent1, "A", { shortcut: "/hi" });
      expect((await call("", agent1, "POST", { title: "B", content: "c", shortcut: "/HI" })).status).toBe(409);
      expect((await call("", agent2, "POST", { title: "C", content: "c", shortcut: "/hi" })).status).toBe(201); // different agent

      await make(supervisor, "Shared", { scope: "SHARED", shortcut: "/policy" });
      expect(
        (await call("", supervisor, "POST", { title: "D", content: "c", shortcut: "/policy", scope: "SHARED" })).status,
      ).toBe(409);
      expect((await call("", agent1, "POST", { title: "E", content: "c", shortcut: "/policy" })).status).toBe(201); // personal vs shared are separate lists
    });

    it("settle simultaneous creates through the database", async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          call("", agent1, "POST", { title: `T${i}`, content: "c", shortcut: "/race" }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      expect(await db.cannedResponse.count()).toBe(1);
    });

    it("are freed by deactivating, and checked again on reactivation", async () => {
      const first = (await make(agent1, "First", { shortcut: "/x" })).id;
      await call(`/${first}`, agent1, "DELETE");
      const second = (await call("", agent1, "POST", { title: "Second", content: "c", shortcut: "/x" })).body.data.id;
      expect((await call(`/${first}`, agent1, "PATCH", { isActive: true })).status).toBe(409);
      expect((await call(`/${first}`, agent1, "PATCH", { isActive: true, shortcut: null })).status).toBe(200);
      expect((await call(`/${second}`, agent1)).body.data.shortcut).toBe("/x");
    });

    it("can be changed and removed", async () => {
      const id = (await make(agent1, "A", { shortcut: "/a" })).id;
      await make(agent1, "B", { shortcut: "/b" });
      expect((await call(`/${id}`, agent1, "PATCH", { shortcut: "/b" })).status).toBe(409);
      expect((await call(`/${id}`, agent1, "PATCH", { shortcut: "/c" })).body.data.shortcut).toBe("/c");
      expect((await call(`/${id}`, agent1, "PATCH", { shortcut: null })).body.data.shortcut).toBeNull();
    });
  });

  it("validates input and requires staff authentication", async () => {
    expect((await call("", agent1, "POST", { title: " ", content: "c" })).status).toBe(400);
    expect((await call("", agent1, "POST", { title: "t", content: "x".repeat(4001) })).status).toBe(400);
    expect((await call("", agent1, "POST", { title: "t", content: "c", shortcut: "nope" })).status).toBe(400);
    expect((await call("", agent1, "POST", { title: "t", content: "c", scope: "TEAM" })).status).toBe(400);
    const id = (await make(agent1, "A")).id;
    expect((await call(`/${id}`, agent1, "PATCH", {})).status).toBe(400);
    expect((await call(`/${id}`, agent1, "PATCH", { scope: "SHARED" })).status).toBe(400); // unknown field alone is an empty update
    expect((await call("/not-a-uuid", agent1)).status).toBe(400);
    expect((await call("", null)).status).toBe(401);
    expect((await call("", customer)).status).toBe(403);
    expect((await call("", customer, "POST", { title: "t", content: "c" })).status).toBe(403);
  });

  it("is enforced by the database: no other scopes, and a team id only on team templates", async () => {
    await expect(
      db.$executeRaw`INSERT INTO canned_responses (title, content, scope, created_by) VALUES ('t', 'c', 'EVERYONE', ${uid(1)}::uuid)`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`INSERT INTO canned_responses (title, content, scope, created_by, team_id) VALUES ('t', 'c', 'SHARED', ${uid(1)}::uuid, ${uid(5)}::uuid)`,
    ).rejects.toThrow();
    await db.$executeRaw`INSERT INTO canned_responses (title, content, scope, created_by) VALUES ('t', 'c', 'SHARED', ${uid(1)}::uuid)`;
  });
});
