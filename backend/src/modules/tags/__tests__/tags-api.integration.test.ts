import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "../../../__tests__/support/container.js";
import { uid } from "../../../__tests__/support/ids.js";

/** Tags and priority over real HTTP and PostgreSQL. Needs TEST_DATABASE_URL. */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const agent1 = `dev:${uid(1)}:AGENT`;
const agent2 = `dev:${uid(2)}:AGENT`;
const supervisor = `dev:${uid(9)}:SUPERVISOR`;
const customer = `dev:${uid(100)}:CUSTOMER`;

describe.skipIf(!url)("tags and priority over HTTP", () => {
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

  const call = async (path: string, token: string | null, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags RESTART IDENTITY CASCADE`;
  });

  /** A conversation owned by agent 1 (owned = true) or waiting in the queue. */
  const conversation = async (n: number, priority = "MEDIUM", owned = true) => {
    const id = (
      await call("/conversations", agent1, "POST", {
        customerId: uid(100 + n),
        applicationId: 200 + n,
        customerName: `Customer ${n}`,
        priority,
      })
    ).body.data.id as string;
    if (owned) await call(`/conversations/${id}/assign`, agent1, "POST", {});
    return id;
  };
  const tag = async (name: string, token = agent1, color?: string) =>
    (await call("/tags", token, "POST", color ? { name, color } : { name })).body.data as { id: string };
  const ids = (response: { body: Record<string, any> }) => response.body.data.map((c: any) => c.customerName);

  describe("tags", () => {
    it("creates, searches, renames and recolors tags", async () => {
      const created = await call("/tags", agent1, "POST", { name: "VIP", color: "#FF0000" });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ name: "VIP", color: "#FF0000", createdBy: uid(1), usageCount: 0 });
      await tag("Docs missing");

      const found = await call("/tags?q=vi", agent2);
      expect(found.body.data.map((t: any) => t.name)).toEqual(["VIP"]);
      expect((await call("/tags", agent2)).body.data.map((t: any) => t.name)).toEqual(["Docs missing", "VIP"]);

      const id = created.body.data.id;
      expect((await call(`/tags/${id}`, agent2, "PATCH", { name: "x" })).status).toBe(403);
      const renamed = await call(`/tags/${id}`, agent1, "PATCH", { name: "Gold", color: null });
      expect(renamed.body.data).toMatchObject({ name: "Gold", color: null });
      expect((await call(`/tags/${id}`, supervisor, "PATCH", { color: "#00ff00" })).body.data.color).toBe("#00ff00");
    });

    it("keeps names unique ignoring case, even for simultaneous requests", async () => {
      expect((await call("/tags", agent1, "POST", { name: "VIP" })).status).toBe(201);
      expect((await call("/tags", agent2, "POST", { name: "vip" })).status).toBe(409);
      await tag("Gold");
      const id = (await call("/tags?q=VIP", agent1)).body.data[0].id;
      expect((await call(`/tags/${id}`, agent1, "PATCH", { name: "GOLD" })).status).toBe(409);
      expect((await call(`/tags/${id}`, agent1, "PATCH", { name: "vip" })).status).toBe(200); // only the case changes

      const race = await Promise.all(Array.from({ length: 4 }, () => call("/tags", agent1, "POST", { name: "Race" })));
      expect(race.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      expect(await db.tag.count({ where: { name: { equals: "race", mode: "insensitive" } } })).toBe(1);
    });

    it("validates names and colors and needs a token", async () => {
      expect((await call("/tags", agent1, "POST", { name: "  " })).status).toBe(400);
      expect((await call("/tags", agent1, "POST", { name: "x".repeat(101) })).status).toBe(400);
      expect((await call("/tags", agent1, "POST", { name: "ok", color: "red" })).status).toBe(400);
      expect((await call("/tags", null, "POST", { name: "ok" })).status).toBe(401);
      expect((await call("/tags", customer, "POST", { name: "ok" })).status).toBe(403);
      expect((await call("/tags", customer)).status).toBe(403);
    });
  });

  describe("tagging a conversation", () => {
    it("sets, replaces and clears tags, with usage counts and a timeline", async () => {
      const cid = await conversation(1);
      const vip = await tag("VIP");
      const docs = await tag("Docs");
      const set = await call(`/conversations/${cid}/tags`, agent1, "PUT", { tagIds: [vip.id, docs.id, vip.id] });
      expect(set.status).toBe(200);
      expect(set.body.data.tags.map((t: any) => t.name)).toEqual(["Docs", "VIP"]);
      expect((await call("/tags", agent1)).body.data.map((t: any) => [t.name, t.usageCount])).toEqual([
        ["Docs", 1],
        ["VIP", 1],
      ]);
      expect((await call(`/conversations/${cid}`, agent1)).body.data.tags).toHaveLength(2);

      await call(`/conversations/${cid}/tags`, agent1, "PUT", { tagIds: [docs.id] });
      const timeline = (await call(`/conversations/${cid}/activities`, agent1)).body.data.map(
        (a: any) => `${a.activityType}:${a.metadata?.tagName}`,
      );
      expect(timeline.filter((t: string) => t.startsWith("TAG_ADDED")).sort()).toEqual([
        "TAG_ADDED:Docs",
        "TAG_ADDED:VIP",
      ]);
      expect(timeline.filter((t: string) => t.startsWith("TAG_REMOVED"))).toEqual(["TAG_REMOVED:VIP"]);

      await call(`/conversations/${cid}/tags`, agent1, "PUT", { tagIds: [docs.id] }); // same set: nothing new
      expect(
        await db.conversationActivity.count({
          where: { conversationId: cid, activityType: { in: ["TAG_ADDED", "TAG_REMOVED"] } },
        }),
      ).toBe(3);

      expect((await call(`/conversations/${cid}/tags`, agent1, "PUT", { tagIds: [] })).body.data.tags).toEqual([]);
    });

    it("refuses unknown tags, too many tags, other agents' chats and non-staff", async () => {
      const cid = await conversation(1);
      const vip = await tag("VIP");
      const unknown = await call(`/conversations/${cid}/tags`, agent1, "PUT", { tagIds: [vip.id, uid(99)] });
      expect(unknown.status).toBe(400);
      expect(unknown.body.error.details.tagIds).toEqual([uid(99)]);
      expect(
        (
          await call(`/conversations/${cid}/tags`, agent1, "PUT", {
            tagIds: Array.from({ length: 21 }, (_, i) => uid(i + 1)),
          })
        ).status,
      ).toBe(400);
      expect((await call(`/conversations/${cid}/tags`, agent2, "PUT", { tagIds: [vip.id] })).status).toBe(404); // cannot see it
      expect((await call(`/conversations/${cid}/tags`, customer, "PUT", { tagIds: [] })).status).toBe(403);
      expect((await call(`/conversations/${cid}/tags`, null, "PUT", { tagIds: [] })).status).toBe(401);
      expect(await db.conversationTag.count()).toBe(0);
    });

    it("lets a supervisor tag any chat and anyone tag a waiting one, but not a viewer", async () => {
      const owned = await conversation(1);
      const waiting = await conversation(2, "MEDIUM", false);
      const vip = await tag("VIP");
      expect((await call(`/conversations/${owned}/tags`, supervisor, "PUT", { tagIds: [vip.id] })).status).toBe(200);
      expect((await call(`/conversations/${waiting}/tags`, agent2, "PUT", { tagIds: [vip.id] })).status).toBe(200);
      await db.conversationAssignment.create({
        data: {
          conversationId: owned,
          agentId: uid(2),
          assignmentType: "VIEWER",
          assignmentAction: "ASSIGNED",
          assignedBy: uid(1),
        },
      });
      expect((await call(`/conversations/${owned}/tags`, agent2, "PUT", { tagIds: [] })).status).toBe(403);
    });

    it("handles simultaneous changes to one conversation without errors or duplicates", async () => {
      const cid = await conversation(1);
      const a = await tag("A");
      const b = await tag("B");
      const results = await Promise.all(
        [[a.id], [b.id], [a.id, b.id], [], [a.id]].map((tagIds) =>
          call(`/conversations/${cid}/tags`, agent1, "PUT", { tagIds }),
        ),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      const rows = await db.conversationTag.findMany({ where: { conversationId: cid } });
      expect(new Set(rows.map((r) => r.tagId)).size).toBe(rows.length);
    });
  });

  describe("deleting a tag in use", () => {
    it("refuses without force, and with force cleans up safely", async () => {
      const c1 = await conversation(1);
      const c2 = await conversation(2);
      const vip = await tag("VIP");
      await call(`/conversations/${c1}/tags`, agent1, "PUT", { tagIds: [vip.id] });
      await call(`/conversations/${c2}/tags`, agent1, "PUT", { tagIds: [vip.id] });

      expect((await call(`/tags/${vip.id}`, agent1, "DELETE")).status).toBe(403);
      const refused = await call(`/tags/${vip.id}`, supervisor, "DELETE");
      expect(refused.status).toBe(409);
      expect(refused.body.error.details).toEqual({ usageCount: 2 });
      expect(await db.tag.count()).toBe(1);

      const forced = await call(`/tags/${vip.id}?force=true`, supervisor, "DELETE");
      expect(forced.body.data).toEqual({ id: vip.id, removedFromConversations: 2 });
      expect(await db.tag.count()).toBe(0);
      expect(await db.conversationTag.count()).toBe(0);
      expect((await call(`/conversations/${c1}`, agent1)).body.data.tags).toEqual([]);
      const removed = await db.conversationActivity.findMany({ where: { activityType: "TAG_REMOVED" } });
      expect(removed.map((a) => a.conversationId).sort()).toEqual([c1, c2].sort());
      expect((await call(`/tags/${vip.id}`, supervisor, "DELETE")).status).toBe(404);
    });

    it("deletes an unused tag without force", async () => {
      const vip = await tag("VIP");
      expect((await call(`/tags/${vip.id}`, supervisor, "DELETE")).body.data.removedFromConversations).toBe(0);
    });
  });

  describe("priority", () => {
    it("defaults to MEDIUM, changes with a timeline entry, and ignores repeats", async () => {
      const cid = await conversation(1);
      expect((await call(`/conversations/${cid}`, agent1)).body.data.priority).toBe("MEDIUM");

      const changed = await call(`/conversations/${cid}/priority`, agent1, "PATCH", { priority: "HIGH" });
      expect(changed.status).toBe(200);
      expect(changed.body.data.priority).toBe("HIGH");
      await call(`/conversations/${cid}/priority`, agent1, "PATCH", { priority: "HIGH" });
      const entries = (await call(`/conversations/${cid}/activities`, agent1)).body.data.filter(
        (a: any) => a.activityType === "PRIORITY_CHANGED",
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorId: uid(1), metadata: { from: "MEDIUM", to: "HIGH" } });
    });

    it("is for the owner, supervisors and unowned chats, with valid values only", async () => {
      const cid = await conversation(1);
      expect((await call(`/conversations/${cid}/priority`, agent2, "PATCH", { priority: "LOW" })).status).toBe(404);
      expect((await call(`/conversations/${cid}/priority`, supervisor, "PATCH", { priority: "LOW" })).status).toBe(200);
      const waiting = await conversation(2, "MEDIUM", false);
      expect((await call(`/conversations/${waiting}/priority`, agent2, "PATCH", { priority: "HIGH" })).status).toBe(
        200,
      );
      expect((await call(`/conversations/${cid}/priority`, agent1, "PATCH", { priority: "URGENT" })).status).toBe(400);
      expect((await call(`/conversations/${cid}/priority`, customer, "PATCH", { priority: "LOW" })).status).toBe(403);
      expect((await call(`/conversations/${cid}/priority`, null, "PATCH", { priority: "LOW" })).status).toBe(401);
    });

    it("is enforced by the database", async () => {
      const cid = await conversation(1);
      await expect(
        db.$executeRaw`UPDATE conversations SET priority = 'URGENT' WHERE id = ${cid}::uuid`,
      ).rejects.toThrow();
    });
  });

  describe("listing", () => {
    it("filters by priority and by one or several tags", async () => {
      const [c1, c2, c3] = [await conversation(1, "HIGH"), await conversation(2, "LOW"), await conversation(3, "HIGH")];
      const vip = await tag("VIP");
      const docs = await tag("Docs");
      await call(`/conversations/${c1}/tags`, agent1, "PUT", { tagIds: [vip.id, docs.id] });
      await call(`/conversations/${c2}/tags`, agent1, "PUT", { tagIds: [docs.id] });
      await call(`/conversations/${c3}/tags`, agent1, "PUT", { tagIds: [vip.id] });

      expect(ids(await call("/conversations?priority=HIGH", agent1)).sort()).toEqual(["Customer 1", "Customer 3"]);
      expect(ids(await call(`/conversations?tag=${vip.id}`, agent1)).sort()).toEqual(["Customer 1", "Customer 3"]);
      expect(ids(await call(`/conversations?tags=${vip.id},${docs.id}`, agent1)).sort()).toEqual([
        "Customer 1",
        "Customer 2",
        "Customer 3",
      ]);
      expect(ids(await call(`/conversations?tags=${vip.id},${docs.id}&tagMatch=all`, agent1))).toEqual(["Customer 1"]);
      expect(ids(await call(`/conversations?tags=${vip.id},${docs.id}&tagMatch=all&priority=LOW`, agent1))).toEqual([]);
      expect(ids(await call(`/conversations?priority=HIGH&tag=${docs.id}`, agent1))).toEqual(["Customer 1"]);
      expect((await call("/conversations?tags=nope", agent1)).status).toBe(400);
      expect((await call("/conversations?priority=URGENT", agent1)).status).toBe(400);
    });

    it("sorts by priority, newest first within each, across page boundaries", async () => {
      // Created in this order, so recency is 1 (oldest) to 6 (newest).
      await conversation(1, "LOW");
      await conversation(2, "HIGH");
      await conversation(3, "MEDIUM");
      await conversation(4, "HIGH");
      await conversation(5, "LOW");
      await conversation(6, "MEDIUM");
      await db.$executeRaw`UPDATE conversations SET last_message_at = now() - (7 - substring(customer_name from 10)::int) * interval '1 minute'`;

      const all = await call("/conversations?sort=priority&size=100", agent1);
      expect(ids(all)).toEqual(["Customer 4", "Customer 2", "Customer 6", "Customer 3", "Customer 5", "Customer 1"]);
      expect(all.body.meta.total).toBe(6);

      const pages: string[] = [];
      for (const page of [1, 2, 3, 4])
        pages.push(...ids(await call(`/conversations?sort=priority&size=2&page=${page}`, agent1)));
      expect(pages).toEqual(ids(all)); // no gaps or repeats at the boundaries
      expect(ids(await call("/conversations?sort=priority&size=4&page=2", agent1))).toEqual([
        "Customer 5",
        "Customer 1",
      ]);
      expect(ids(await call("/conversations?sort=priority&size=2&page=9", agent1))).toEqual([]);
      expect(ids(await call("/conversations?size=100", agent1))[0]).toBe("Customer 6"); // default stays latest first
      expect((await call("/conversations?sort=urgency", agent1)).status).toBe(400);
    });

    it("combines priority sorting with filters", async () => {
      await conversation(1, "LOW");
      await conversation(2, "HIGH");
      await conversation(3, "MEDIUM");
      expect(ids(await call("/conversations?sort=priority&priority=LOW", agent1))).toEqual(["Customer 1"]);
      expect(ids(await call("/conversations?sort=priority&filter=mine", agent1))).toEqual([
        "Customer 2",
        "Customer 3",
        "Customer 1",
      ]);
    });
  });
});
