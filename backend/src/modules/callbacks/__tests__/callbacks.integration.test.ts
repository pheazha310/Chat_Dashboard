import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase, createTestContainer } from "../../../__tests__/support/container.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";

/** Real repository and services on PostgreSQL. Needs TEST_DATABASE_URL (see conversation-flow.integration.test.ts). */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const agent1: AuthContext = { userId: uid(1), role: "AGENT" };
const agent2: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };

const MIN = 60_000;
const hoursAhead = (hours: number) => new Date(Date.now() + hours * 60 * MIN);

describe.skipIf(!url)("callbacks on PostgreSQL", () => {
  let db: typeof import("@config/database.js").prisma;
  let c: Awaited<ReturnType<typeof createTestContainer>>;
  let conversationId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    c = await createTestContainer();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  const makeConversation = async (n: number) =>
    (
      await c.conversations.create(agent1, {
        customerId: uid(100 + n),
        applicationId: uid(200 + n),
        customerName: `Customer ${n}`,
        priority: "MEDIUM",
      })
    ).conversation.id;

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, callback_requests RESTART IDENTITY CASCADE`;
    conversationId = await makeConversation(1);
    await c.assignments.assign(agent1, conversationId, {});
    c.events.length = 0;
  });

  const schedule = (at = hoursAhead(1), extra: { notes?: string | null; assignedAgentId?: string } = {}) =>
    c.callbacks.create(agent1, conversationId, { scheduledAt: at, ...extra });
  const notificationsOf = (agentId: string) =>
    db.notification.findMany({ where: { recipientId: agentId, notificationType: "CALLBACK" } });

  it("stores a callback for the conversation's customer, assigned to its owner, with a timeline entry and an event", async () => {
    const at = hoursAhead(2);
    const created = await schedule(at, { notes: "after 5pm" });

    expect(created).toMatchObject({
      conversationId,
      customerId: uid(101),
      assignedAgentId: uid(1),
      createdBy: uid(1),
      status: "PENDING",
      notes: "after 5pm",
      scheduledAt: at.toISOString(),
    });
    const activities = await db.conversationActivity.findMany({ where: { conversationId, activityType: "CALLBACK" } });
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ actorType: "AGENT", actorId: uid(1) });
    expect(c.published("callback.created")).toHaveLength(1);
    expect((await c.callbacks.listForConversation(agent1, conversationId)).map((cb) => cb.id)).toEqual([created.id]);
  });

  it("hides callbacks of conversations the agent cannot see, and lets a supervisor schedule and manage", async () => {
    const created = await schedule();
    await expect(c.callbacks.create(agent2, conversationId, { scheduledAt: hoursAhead(1) })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(c.callbacks.listForConversation(agent2, conversationId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(c.callbacks.get(agent2, created.id)).rejects.toBeInstanceOf(NotFoundError);

    await expect(c.callbacks.cancel(supervisor, created.id)).resolves.toMatchObject({ status: "CANCELLED" });
  });

  it("lets a viewer read a callback but not change it", async () => {
    const created = await schedule();
    await db.conversationAssignment.create({
      data: {
        conversationId,
        agentId: uid(2),
        assignmentType: "VIEWER",
        assignmentAction: "ASSIGNED",
        assignedBy: uid(1),
      },
    });
    await expect(c.callbacks.get(agent2, created.id)).resolves.toMatchObject({
      id: created.id,
      permissions: { canEdit: false, canComplete: false, canCancel: false },
    });
    await expect(c.callbacks.cancel(agent2, created.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(c.callbacks.update(agent2, created.id, { notes: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await c.callbacks.get(agent1, created.id)).status).toBe("PENDING");
  });

  it("assigns to another agent who can see the conversation and tells only them, once", async () => {
    const other = await makeConversation(2); // waiting, so every agent sees it
    const created = await c.callbacks.create(agent1, other, { scheduledAt: hoursAhead(1), assignedAgentId: uid(2) });

    expect(created.assignedAgentId).toBe(uid(2));
    expect(await notificationsOf(uid(2))).toHaveLength(1);
    expect(await notificationsOf(uid(1))).toHaveLength(0);
  });

  it("rejects an assignee who cannot see the conversation, storing nothing", async () => {
    await expect(schedule(hoursAhead(1), { assignedAgentId: uid(2) })).rejects.toBeInstanceOf(BadRequestError);
    expect(await db.callbackRequest.count()).toBe(0);
  });

  it("reminds the assignee once, and again after a reschedule", async () => {
    const created = await schedule(hoursAhead(1));
    const soon = new Date(Date.now() + 55 * MIN); // 5 minutes before: inside the 10-minute reminder window

    expect(await c.callbacks.processDue(new Date(Date.now() + 30 * MIN))).toEqual({ missed: 0, reminded: 0 });
    expect(await c.callbacks.processDue(soon)).toEqual({ missed: 0, reminded: 1 });
    expect(await c.callbacks.processDue(soon)).toEqual({ missed: 0, reminded: 0 });

    expect(await notificationsOf(uid(1))).toHaveLength(1);
    const reminder = c.published("callback.reminder");
    expect(reminder).toHaveLength(1);
    expect(reminder[0]?.audience).toEqual({ kind: "users", userIds: [uid(1)] });

    await c.callbacks.update(agent1, created.id, { scheduledAt: hoursAhead(3) });
    expect(await c.callbacks.processDue(new Date(Date.now() + 2.9 * 60 * MIN))).toMatchObject({ reminded: 1 });
    expect(await notificationsOf(uid(1))).toHaveLength(2);
  });

  it("marks an unhandled callback missed after the grace period, which can still be completed late", async () => {
    const created = await schedule(hoursAhead(1));
    const justAfter = new Date(Date.now() + 60 * MIN + 5 * MIN);
    expect(await c.callbacks.processDue(justAfter)).toMatchObject({ missed: 0 }); // still within the grace period

    const late = new Date(Date.now() + 60 * MIN + 16 * MIN);
    expect(await c.callbacks.processDue(late)).toMatchObject({ missed: 1 });
    expect(await c.callbacks.processDue(late)).toMatchObject({ missed: 0 });

    expect(await c.callbacks.get(agent1, created.id)).toMatchObject({ status: "MISSED" });
    const activity = await db.conversationActivity.findFirstOrThrow({
      where: { conversationId, activityType: "CALLBACK", actorType: "SYSTEM" },
    });
    expect(activity.actorId).toBeNull();
    expect((await notificationsOf(uid(1))).map((n) => n.title)).toContain("Missed callback");
    expect(c.published("callback.missed")).toHaveLength(1);

    const done = await c.callbacks.complete(agent1, created.id, { completionNote: "Reached the customer" });
    expect(done).toMatchObject({ status: "COMPLETED", completionNote: "Reached the customer" });
    expect(done.completedAt).not.toBeNull();
    expect(await c.callbacks.processDue(new Date(Date.now() + 5 * 60 * 60 * MIN))).toEqual({ missed: 0, reminded: 0 });
  });

  it("never reminds about or misses completed or cancelled callbacks", async () => {
    const done = await schedule(hoursAhead(1));
    const dropped = await schedule(hoursAhead(1));
    await c.callbacks.complete(agent1, done.id, {});
    await c.callbacks.cancel(agent1, dropped.id);

    expect(await c.callbacks.processDue(new Date(Date.now() + 3 * 60 * MIN))).toEqual({ missed: 0, reminded: 0 });
    expect(await db.callbackRequest.count({ where: { status: { in: ["COMPLETED", "CANCELLED"] } } })).toBe(2);
  });

  it("sends each reminder and each missed mark exactly once when several instances run the job at the same time", async () => {
    for (let i = 0; i < 6; i++) await schedule(hoursAhead(1));
    const dueSoon = new Date(Date.now() + 55 * MIN);
    const runs = await Promise.all(Array.from({ length: 5 }, () => c.callbacks.processDue(dueSoon)));
    expect(runs.reduce((sum, r) => sum + r.reminded, 0)).toBe(6);
    expect(await notificationsOf(uid(1))).toHaveLength(6);

    const overdue = new Date(Date.now() + 2 * 60 * MIN);
    const missedRuns = await Promise.all(Array.from({ length: 5 }, () => c.callbacks.processDue(overdue)));
    expect(missedRuns.reduce((sum, r) => sum + r.missed, 0)).toBe(6);
    expect(await db.conversationActivity.count({ where: { activityType: "CALLBACK", actorType: "SYSTEM" } })).toBe(6);
  });

  it("lets only one of two simultaneous completions win, and nothing changes after cancel", async () => {
    const created = await schedule();
    const results = await Promise.allSettled([
      c.callbacks.complete(agent1, created.id, {}),
      c.callbacks.complete(supervisor, created.id, {}),
      c.callbacks.cancel(agent1, created.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
    }
    expect(await db.conversationActivity.count({ where: { conversationId, activityType: "CALLBACK" } })).toBe(2); // created + one outcome
  });

  it("rejects changes to a closed callback", async () => {
    const created = await schedule();
    await c.callbacks.cancel(agent1, created.id);
    await expect(c.callbacks.update(agent1, created.id, { notes: "x" })).rejects.toBeInstanceOf(ConflictError);
    await expect(c.callbacks.complete(agent1, created.id, {})).rejects.toBeInstanceOf(ConflictError);
  });

  it("caps pending callbacks per conversation", async () => {
    for (let i = 0; i < 20; i++) await schedule(hoursAhead(1 + i));
    await expect(schedule()).rejects.toBeInstanceOf(ConflictError);
    expect(await db.callbackRequest.count()).toBe(20);
  });

  it("lists my callbacks soonest first with filters, and keeps everyone's for supervisors", async () => {
    const later = await schedule(hoursAhead(5));
    const sooner = await schedule(hoursAhead(2));
    const other = await makeConversation(3);
    await c.callbacks.create(supervisor, other, { scheduledAt: hoursAhead(1) }); // assigned to the supervisor
    await c.callbacks.cancel(agent1, later.id);

    const mine = await c.callbacks.list(agent1, { page: 1, size: 25, scope: "mine" });
    expect(mine.items.map((cb) => cb.id)).toEqual([sooner.id, later.id]);
    expect(mine.meta.total).toBe(2);
    const pending = await c.callbacks.list(agent1, { page: 1, size: 25, scope: "mine", status: "PENDING" });
    expect(pending.items.map((cb) => cb.id)).toEqual([sooner.id]);
    const window = await c.callbacks.list(agent1, { page: 1, size: 25, scope: "mine", to: hoursAhead(3) });
    expect(window.items.map((cb) => cb.id)).toEqual([sooner.id]);

    expect((await c.callbacks.list(supervisor, { page: 1, size: 25, scope: "all" })).meta.total).toBe(3);
    await expect(c.callbacks.list(agent1, { page: 1, size: 25, scope: "all" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the database refuses a completed callback without a completion time", async () => {
    const created = await schedule();
    await expect(
      db.$executeRaw`UPDATE callback_requests SET status = 'COMPLETED' WHERE id = ${created.id}::uuid`,
    ).rejects.toThrow();
  });
});
