import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "./support/container.js";
import { uid } from "./support/ids.js";

/** HTTP-level check of auth, validation, envelopes and status codes. Needs TEST_DATABASE_URL (see the flow test). */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

describe.skipIf(!url)("/api/v1/admin/conversations over HTTP", () => {
  let server: Server;
  let base: string;
  let db: typeof import("@config/database.js").prisma;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    process.env.AUTH_MODE = "dev";
    process.env.EVENT_BUS = "memory";
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    const { app } = await import("../app.js");
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/admin/conversations`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await db?.$disconnect();
  });

  /** Ids are random UUIDs, so "/1" in a path stands for the first conversation created in the current test, "/2" the second. */
  let madeIds: string[] = [];

  beforeEach(async () => {
    madeIds = [];
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags RESTART IDENTITY CASCADE`;
  });

  const call = async (path: string, token: string | null, method = "GET", body?: unknown) => {
    const target = path.replace(/^\/(\d)(?=\/|$)/, (_, n: string) => `/${madeIds[Number(n) - 1]}`);
    const response = await fetch(`${base}${target}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = { status: response.status, body: (await response.json()) as Record<string, any> };
    if (method === "POST" && path === "" && response.status === 201) madeIds.push(result.body.data.id);
    return result;
  };
  const agent1 = `dev:${uid(1)}:AGENT`;
  const agent2 = `dev:${uid(2)}:AGENT`;

  it("serves the OpenAPI document publicly", async () => {
    const response = await fetch(base.replace("/conversations", "/openapi.json"));
    expect(response.status).toBe(200);
    const doc = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/conversations/{id}/messages");
  });

  it("signs in the LOS way with AUTH_MODE=dev (POST /api/v1/dev/login), and the token works", async () => {
    const devLogin = (body: unknown) =>
      fetch(base.replace("/api/v1/admin/conversations", "/api/v1/dev/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const response = await devLogin({ type: "staff", userId: 3, username: "Sophea", role: "agent" });
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: { accessToken: string; user: Record<string, unknown> } };
    expect(data.user).toMatchObject({ email: null, losUserId: 3, role: "AGENT" });
    expect((await call("", data.accessToken)).status).toBe(200);
    expect((await devLogin({ type: "staff", role: "boss" })).status).toBe(400);
  });

  it("rejects missing, malformed and customer tokens", async () => {
    expect((await call("", null)).status).toBe(401);
    expect((await call("", "garbage")).status).toBe(401);
    const customer = await call("", `dev:${uid(5)}:CUSTOMER`);
    expect(customer.status).toBe(403);
    expect(customer.body).toMatchObject({ status: "error", error: { code: "FORBIDDEN" } });
  });

  it("validates input with a 400 and the standard error envelope", async () => {
    const bad = await call("", agent1, "POST", { customerId: "abc" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("BAD_REQUEST");
    expect((await call("/abc", agent1)).status).toBe(400);
    expect((await call("?size=500", agent1)).status).toBe(400);
  });

  it("walks create → take over → forbidden/hidden for others → list → resolve", async () => {
    const created = await call("", agent1, "POST", {
      customerId: uid(300),
      applicationId: uid(55),
      customerName: "Dara Sok",
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      id: created.body.data.id,
      handoffStatus: "NEEDS_HUMAN",
      customerName: "Dara Sok",
    });
    expect((await call("", agent1, "POST", { customerId: uid(300), applicationId: uid(55) })).status).toBe(200); // reused

    const taken = await call("/1/assign", agent1, "POST", {});
    expect(taken.status).toBe(200);
    expect(taken.body.data).toMatchObject({ agentId: uid(1), type: "OWNER", action: "TAKEOVER" });

    expect((await call("/1", agent2)).status).toBe(404); // hidden from other agents
    expect((await call("/1/assign", agent2, "POST", {})).status).toBe(404);
    expect((await call("/1/assign", agent2, "POST", { agentId: uid(3) })).status).toBe(404);
    expect((await call("/1/transfer", agent2, "POST", { agentId: uid(3) })).status).toBe(404);
    expect((await call("/1/assign", agent1, "POST", { agentId: uid(3) })).status).toBe(403); // only supervisors assign others
    expect((await call("/1/assign", agent1, "POST", {})).status).toBe(409); // already yours

    const mine = await call("?filter=mine", agent1);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.meta).toEqual({ total: 1, page: 1, size: 25, totalPages: 1 });
    expect((await call("?filter=mine", agent2)).body.data).toHaveLength(0);

    const detail = await call("/1", agent1);
    expect(detail.body.data.permissions).toMatchObject({ canSendMessage: true, canResolve: true, canTakeOver: false });

    expect((await call("/1/status", agent2, "PATCH", { status: "RESOLVED" })).status).toBe(404);
    const resolved = await call("/1/status", agent1, "PATCH", { status: "RESOLVED" });
    expect(resolved.body.data).toMatchObject({ status: "RESOLVED", assignedAgentId: null });
    expect((await call("/1/status", agent1, "PATCH", { status: "RESOLVED" })).status).toBe(409);

    const activities = await call("/1/activities", agent1);
    expect(activities.body.data.map((a: { activityType: string }) => a.activityType)).toEqual([
      "STATUS_CHANGED",
      "ASSIGNED",
    ]);
    expect((await call(`/${uid(999)}`, agent1)).status).toBe(404);
  });

  it("sends idempotently, pages history, syncs after a reconnect and tracks read state", async () => {
    await call("", agent1, "POST", { customerId: uid(300), applicationId: uid(55), customerName: "Dara Sok" });
    await call("/1/assign", agent1, "POST", {});

    expect((await call("/1/messages", agent1, "POST", { clientId: "", text: "x" })).status).toBe(400);
    expect((await call("/1/messages", agent1, "POST", { clientId: "c1", text: "   " })).status).toBe(400);
    expect((await call("/1/messages", agent2, "POST", { clientId: "c1", text: "hi" })).status).toBe(404);

    const sent = await call("/1/messages", agent1, "POST", { clientId: "c1", text: "Hello Dara" });
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({
      clientId: "c1",
      senderType: "AGENT",
      content: "Hello Dara",
      status: "SENT",
    });
    const retry = await call("/1/messages", agent1, "POST", { clientId: "c1", text: "Hello Dara" });
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(sent.body.data.id);

    const { container } = await import("../app-container.js");
    const messageService = container.messages;
    await messageService.receiveFromCustomer({
      customerId: uid(300),
      conversationId: madeIds[0] as string,
      clientId: "k1",
      text: "Thanks",
    });
    await messageService.receiveFromCustomer({
      customerId: uid(300),
      conversationId: madeIds[0] as string,
      clientId: "k2",
      text: "One more thing",
    });

    const latest = await call("/1/messages?limit=2", agent1);
    expect(latest.body.data.map((m: { content: string }) => m.content)).toEqual(["Thanks", "One more thing"]);
    expect(latest.body.meta).toMatchObject({ limit: 2, hasMore: true, direction: "older" });
    const older = await call(`/1/messages?limit=10&before=${latest.body.meta.oldestSequence}`, agent1);
    expect(older.body.data.map((m: { content: string }) => m.content)).toEqual([
      `Agent ${uid(1)} took over the conversation`,
      "Hello Dara",
    ]);
    const missed = await call(`/1/messages?after=${sent.body.data.sequenceNumber}`, agent1);
    expect(missed.body.data.map((m: { content: string }) => m.content)).toEqual(["Thanks", "One more thing"]);
    expect((await call("/1/messages?before=3&after=1", agent1)).status).toBe(400);
    expect((await call("/1/messages", agent2)).status).toBe(404);

    expect((await call("", agent1)).body.data[0].unreadCount).toBe(2);
    const read = await call("/1/read", agent1, "POST", {});
    expect(read.body.data).toMatchObject({ unreadCount: 0, markedUnread: false });
    expect((await call("", agent1)).body.data[0].unreadCount).toBe(0);
    expect((await call("/1/unread", agent1, "POST")).body.data).toMatchObject({ markedUnread: true, unreadCount: 1 });
    expect((await call("/1/read", agent2, "POST", {})).status).toBe(404);

    const customerMessage = latest.body.data[0].id;
    expect((await call(`/1/messages/${customerMessage}/delivered`, agent1, "POST")).body.data.status).toBe("READ");
    expect((await call(`/1/messages/${sent.body.data.id}/delivered`, agent1, "POST")).status).toBe(400);
    expect((await call(`/1/messages/${uid(999)}/delivered`, agent1, "POST")).status).toBe(404);
  });

  describe("notifications", () => {
    const sup = `dev:${uid(9)}:SUPERVISOR`;
    const agent3 = `dev:${uid(3)}:AGENT`;
    const root = () => base.replace("/conversations", "");
    const api = async (path: string, token: string, method = "GET", body?: unknown) => {
      const response = await fetch(`${root()}${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    };

    it("delivers, counts and marks read per recipient, and never exposes someone else's", async () => {
      await call("", agent1, "POST", { customerId: uid(300), applicationId: uid(55), customerName: "Dara Sok" });
      expect((await call("/1/assign", sup, "POST", { agentId: uid(3) })).status).toBe(200);

      const mine = await api("/notifications", agent3);
      expect(mine.body.data).toHaveLength(1);
      expect(mine.body.data[0]).toMatchObject({ type: "ASSIGNED", read: false, conversationId: madeIds[0] });
      expect(mine.body.meta).toMatchObject({ total: 1, unreadCount: 1 });
      expect((await api("/notifications/unread-count", agent3)).body.data).toEqual({ unreadCount: 1 });
      expect((await api("/notifications", agent1)).body.data).toEqual([]);
      expect((await api("/notifications/unread-count", agent1)).body.data).toEqual({ unreadCount: 0 });

      const id = mine.body.data[0].id as string;
      expect((await api(`/notifications/${id}/read`, agent1, "PATCH")).status).toBe(404); // not theirs
      expect((await api("/notifications/abc/read", agent3, "PATCH")).status).toBe(400);
      expect((await api(`/notifications/${id}/read`, agent3, "PATCH")).body.data.read).toBe(true);
      expect((await api(`/notifications/${id}/read`, agent3, "PATCH")).status).toBe(200); // idempotent
      expect((await api("/notifications?unread=true", agent3)).body.data).toEqual([]);
      expect((await api("/notifications/unread-count", agent3)).body.data.unreadCount).toBe(0);
      expect((await api("/notifications", "garbage")).status).toBe(401);
    });

    it("marks everything read and stores preferences, with every switch on by default", async () => {
      await call("", agent1, "POST", { customerId: uid(300), applicationId: uid(55) });
      await call("/1/assign", sup, "POST", { agentId: uid(3) });
      await call("/1/transfer", sup, "POST", { agentId: uid(4) });
      await call("/1/transfer", sup, "POST", { agentId: uid(3) });
      expect((await api("/notifications/unread-count", agent3)).body.data.unreadCount).toBe(3); // assigned, moved away, back
      expect((await api("/notifications/read-all", agent3, "POST")).body.data).toEqual({ updated: 3, unreadCount: 0 });

      expect((await api("/notifications/preferences", agent3)).body.data).toEqual({
        newMessage: true,
        assignment: true,
        transfer: true,
        mention: true,
        sound: true,
        browser: true,
      });
      expect((await api("/notifications/preferences", agent3, "PUT", {})).status).toBe(400);
      expect((await api("/notifications/preferences", agent3, "PUT", { sound: "yes" })).status).toBe(400);
      const changed = await api("/notifications/preferences", agent3, "PUT", { transfer: false, browser: false });
      expect(changed.body.data).toMatchObject({ transfer: false, browser: false, assignment: true });
      expect((await api("/notifications/preferences", agent3)).body.data.transfer).toBe(false); // persisted
      expect((await api("/notifications/preferences", agent1)).body.data.transfer).toBe(true); // per agent

      await call("/1/transfer", sup, "POST", { agentId: uid(4) });
      await call("/1/transfer", sup, "POST", { agentId: uid(3) });
      const unreadTypes = (await api("/notifications?unread=true", agent3)).body.data.map(
        (n: { type: string }) => n.type,
      );
      expect(unreadTypes).toEqual([]); // transfer switched off: nothing stored for agent 3
    });

    it("mutes a conversation only for someone who can see it", async () => {
      await call("", agent1, "POST", { customerId: uid(300), applicationId: uid(55) });
      await call("/1/assign", sup, "POST", { agentId: uid(3) });
      expect((await call("/1/mute", agent2, "PUT", { muted: true })).status).toBe(404);
      expect((await call("/1/mute", agent3, "PUT", { muted: "yes" })).status).toBe(400);
      expect((await call("/1/mute", agent3, "PUT", { muted: true })).body.data).toEqual({
        conversationId: madeIds[0] as string,
        muted: true,
      });
      expect(await db.conversationNotificationSetting.count({ where: { agentId: uid(3), isMuted: true } })).toBe(1);
      expect((await call("/1/mute", agent3, "PUT", { muted: false })).body.data.muted).toBe(false);
    });
  });

  describe("customer information", () => {
    const sup = `dev:${uid(9)}:SUPERVISOR`;
    const owner = `dev:${uid(3)}:AGENT`;

    it("shows the profile by role, hides the conversation from other agents, and says where the data came from", async () => {
      await call("", agent1, "POST", { customerId: uid(300), applicationId: uid(55), customerName: "Dara Sok" });
      await call("/1/assign", owner, "POST", {});

      const own = (await call("/1/customer", owner)).body.data;
      expect(own).toMatchObject({
        id: uid(300),
        source: "dev-stub",
        email: `customer-${uid(300)}@example.test`,
        nationalId: null,
      });
      expect(own.restricted).toEqual(["nationalId", "occupation", "salary"]);
      const boss = (await call("/1/customer", sup)).body.data;
      expect(boss).toMatchObject({ nationalId: `DEV-${uid(300)}`, restricted: [] });

      expect((await call("/1/customer", agent2)).status).toBe(404); // cannot see the conversation, so no customer data
      expect((await call("/1/customer", "garbage")).status).toBe(401);
      expect((await call(`/${uid(999)}/customer`, owner)).status).toBe(404);
    });

    it("lists the customer's other conversations and the participants with names", async () => {
      await call("", agent1, "POST", { customerId: uid(300), applicationId: uid(55) });
      await call("/1/assign", owner, "POST", {});
      await call("", agent1, "POST", { customerId: uid(300), applicationId: uid(56) });
      await call("", agent1, "POST", { customerId: uid(301), applicationId: uid(57) }); // someone else's customer
      await call("/1/status", owner, "PATCH", { status: "RESOLVED" });
      await call("/2/status", sup, "PATCH", { status: "CLOSED" });

      const others = await call("/1/customer/conversations", owner);
      expect(others.status).toBe(200);
      expect(others.body.data.map((c: { id: string }) => c.id)).toEqual([madeIds[1]]); // closed ones included, current and others' excluded
      expect(others.body.data[0]).toMatchObject({ status: "CLOSED", customerId: uid(300) });
      expect(others.body.meta.total).toBe(1);

      await call("/1/status", sup, "PATCH", { status: "OPEN" });
      await call("/1/assign", owner, "POST", {});
      const people = (await call("/1/participants", owner)).body.data;
      const names = people.map((p: { participantType: string; profile: { name: string } | null }) => [
        p.participantType,
        p.profile?.name,
      ]);
      expect(names).toEqual(
        expect.arrayContaining([
          ["CUSTOMER", `Customer ${uid(300)}`],
          ["AGENT", `Agent ${uid(3)}`],
        ]),
      );
      expect(
        people.find(
          (p: { participantType: string; participantId: string; leftAt: unknown }) =>
            p.participantType === "AGENT" && p.participantId === uid(3) && p.leftAt === null,
        )?.role,
      ).toBe("OWNER");
      expect((await call("/1/participants", agent2)).status).toBe(404);
    });

    it("shows the assigned agent's name in the inbox", async () => {
      await call("", agent1, "POST", { customerId: uid(300), applicationId: uid(55) });
      await call("/1/assign", owner, "POST", {});
      const [item] = (await call("", sup)).body.data;
      expect(item).toMatchObject({ assignedAgentId: uid(3), assignedAgent: { id: uid(3), name: `Agent ${uid(3)}` } });
      expect((await call(`?customerId=${uid(300)}`, sup)).body.data).toHaveLength(1);
      expect((await call(`?customerId=${uid(999)}`, sup)).body.data).toHaveLength(0);
    });
  });
});
