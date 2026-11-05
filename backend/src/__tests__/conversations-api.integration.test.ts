import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/** HTTP-level check of auth, validation, envelopes and status codes. Needs TEST_DATABASE_URL (see the flow test). */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

describe.skipIf(!url)("/api/conversations over HTTP", () => {
  let server: Server;
  let base: string;
  let db: typeof import("@config/database.js").prisma;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    process.env.AUTH_MODE = "dev";
    db = (await import("@config/database.js")).prisma;
    const { app } = await import("../app.js");
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/conversations`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags RESTART IDENTITY CASCADE`;
  });

  const call = async (path: string, token: string | null, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const agent1 = "dev:1:AGENT";
  const agent2 = "dev:2:AGENT";

  it("rejects missing, malformed and customer tokens", async () => {
    expect((await call("", null)).status).toBe(401);
    expect((await call("", "garbage")).status).toBe(401);
    const customer = await call("", "dev:5:CUSTOMER");
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
      customerId: "300",
      applicationId: "55",
      customerName: "Dara Sok",
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ id: "1", handoffStatus: "NEEDS_HUMAN", customerName: "Dara Sok" });
    expect((await call("", agent1, "POST", { customerId: "300", applicationId: "55" })).status).toBe(200); // reused

    const taken = await call("/1/assign", agent1, "POST", {});
    expect(taken.status).toBe(200);
    expect(taken.body.data).toMatchObject({ agentId: "1", type: "OWNER", action: "TAKEOVER" });

    expect((await call("/1", agent2)).status).toBe(404); // hidden from other agents
    expect((await call("/1/assign", agent2, "POST", {})).status).toBe(404);
    expect((await call("/1/assign", agent2, "POST", { agentId: "3" })).status).toBe(404);
    expect((await call("/1/transfer", agent2, "POST", { agentId: "3" })).status).toBe(404);
    expect((await call("/1/assign", agent1, "POST", { agentId: "3" })).status).toBe(403); // only supervisors assign others
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
    expect((await call("/999", agent1)).status).toBe(404);
  });
});
