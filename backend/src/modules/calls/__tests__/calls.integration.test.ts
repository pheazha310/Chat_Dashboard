import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase, createTestContainer } from "../../../__tests__/support/container.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";

/** Real repository and services on PostgreSQL. Needs TEST_DATABASE_URL (see conversation-flow.integration.test.ts). */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const agent1: AuthContext = { userId: uid(1), role: "AGENT" };
const agent2: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const customerId = uid(101);
const A1 = { type: "AGENT", auth: agent1 } as const;
const C = { type: "CUSTOMER", id: customerId } as const;
const sdp = (callId: string) => ({ callId, sdp: "v=0\r\n" });
const MIN = 60_000;

describe.skipIf(!url)("calls on PostgreSQL", () => {
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
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, calls RESTART IDENTITY CASCADE`;
    conversationId = await makeConversation(1);
    await c.assignments.assign(agent1, conversationId, {});
    c.events.length = 0;
  });

  const callActivities = () => db.conversationActivity.findMany({ where: { conversationId, activityType: "CALL" } });
  /** An answered call: agent1 called, the customer accepted. */
  const answeredCall = async () => {
    const call = await c.calls.start(agent1, conversationId, { callType: "AUDIO" });
    await c.calls.acceptByCustomer(customerId, call.id);
    c.events.length = 0;
    return call.id;
  };

  it("an agent calls the customer: ringing, participants, timeline entry, and only the customer's channel is rung", async () => {
    const call = await c.calls.start(agent1, conversationId, { callType: "VIDEO" });

    expect(call).toMatchObject({ status: "RINGING", callType: "VIDEO", initiatedBy: { type: "AGENT", id: uid(1) } });
    expect(call.participants.map((p) => [p.type, p.id, p.joinedAt !== null])).toEqual([
      ["AGENT", uid(1), true],
      ["CUSTOMER", customerId, false],
    ]);
    expect((await callActivities()).map((a) => a.description)).toEqual(["Call started"]);
    const incoming = c.published("call.incoming");
    expect(incoming).toHaveLength(1);
    expect(incoming[0]?.audience).toEqual({ kind: "users", userIds: [customerId] });
    expect(JSON.stringify(c.events)).not.toContain("Customer 1"); // no profile data in call events
  });

  it("only the owner may call; others cannot see or start it", async () => {
    await expect(c.calls.start(supervisor, conversationId, { callType: "AUDIO" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(c.calls.start(agent2, conversationId, { callType: "AUDIO" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.call.count()).toBe(0);
  });

  it("allows one open call per conversation, also under simultaneous attempts", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => c.calls.start(agent1, conversationId, { callType: "AUDIO" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
    expect(await db.call.count()).toBe(1);
    expect(await db.callParticipant.count()).toBe(2);
  });

  it("the database refuses a second open call even if the service check is bypassed", async () => {
    await c.calls.start(agent1, conversationId, { callType: "AUDIO" });
    await expect(
      db.call.create({
        data: { conversationId, initiatedByType: "AGENT", initiatedById: uid(1), callType: "AUDIO", status: "ACTIVE" },
      }),
    ).rejects.toThrow();
  });

  it("the customer accepts: the call is active, everyone is told, and the agent cannot accept their own call", async () => {
    const call = await c.calls.start(agent1, conversationId, { callType: "AUDIO" });
    await expect(c.calls.accept(agent1, call.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(c.calls.acceptByCustomer(uid(555), call.id)).rejects.toBeInstanceOf(NotFoundError);
    c.events.length = 0;

    const accepted = await c.calls.acceptByCustomer(customerId, call.id);
    expect(accepted).toMatchObject({ status: "ACTIVE" });
    expect(accepted.startedAt).not.toBeNull();
    expect((await db.callParticipant.findMany({ where: { callId: call.id } })).every((p) => p.joinedAt !== null)).toBe(
      true,
    );
    expect(
      c
        .published("call.accepted")
        .map((e) => e.audience.kind)
        .sort(),
    ).toEqual(["conversation", "users"]);
    await expect(c.calls.acceptByCustomer(customerId, call.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("relays the offer, answer and candidates between the two parties only, naming the sender", async () => {
    const callId = await answeredCall();

    await c.calls.relay(A1, "offer", sdp(callId));
    await c.calls.relay(C, "answer", sdp(callId));
    await c.calls.relay(A1, "ice_candidate", { callId, candidate: { candidate: "candidate:1", sdpMid: "0" } });
    await c.calls.relay(C, "ice_candidate", { callId, candidate: null });

    const relayed = c.events.map((e) => [e.type, e.audience]);
    expect(relayed).toEqual([
      ["call.offer", { kind: "users", userIds: [customerId] }],
      ["call.answer", { kind: "users", userIds: [uid(1)] }],
      ["call.ice_candidate", { kind: "users", userIds: [customerId] }],
      ["call.ice_candidate", { kind: "users", userIds: [uid(1)] }],
    ]);
    expect(c.events[0]?.payload).toEqual({ callId, from: { type: "AGENT", id: uid(1) }, sdp: "v=0\r\n" });
  });

  it("refuses signalling from outsiders, with the wrong role, before the answer and after the end", async () => {
    const call = await c.calls.start(agent1, conversationId, { callType: "AUDIO" });
    await expect(c.calls.relay(A1, "offer", sdp(call.id))).rejects.toBeInstanceOf(ConflictError); // not answered yet
    await c.calls.acceptByCustomer(customerId, call.id);
    c.events.length = 0;

    await expect(c.calls.relay({ type: "AGENT", auth: agent2 }, "offer", sdp(call.id))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      c.calls.relay({ type: "AGENT", auth: supervisor }, "ice_candidate", { callId: call.id, candidate: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(c.calls.relay({ type: "CUSTOMER", id: uid(555) }, "answer", sdp(call.id))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(c.calls.relay(C, "offer", sdp(call.id))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(c.calls.relay(A1, "answer", sdp(call.id))).rejects.toBeInstanceOf(ForbiddenError);
    expect(c.events).toHaveLength(0);

    await c.calls.end(agent1, call.id);
    await expect(c.calls.relay(A1, "offer", sdp(call.id))).rejects.toBeInstanceOf(ConflictError);
    await expect(c.calls.relay(A1, "offer", sdp(uid(777)))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ends an answered call once, with its duration and timeline entry", async () => {
    const callId = await answeredCall();
    await db.call.update({ where: { id: callId }, data: { startedAt: new Date(Date.now() - 90_000) } });

    const ended = await c.calls.end(agent1, callId);
    expect(ended.status).toBe("ENDED");
    expect(ended.durationSeconds).toBeGreaterThanOrEqual(89);
    expect(ended.participants.every((p) => p.leftAt !== null)).toBe(true);
    expect(c.published("call.ended")).toHaveLength(2); // the conversation's viewers and the customer
    const entry = (await callActivities()).find((a) => a.description === "Call ended");
    expect(entry?.metadata).toMatchObject({ action: "ended" });

    await expect(c.calls.end(agent1, callId)).rejects.toBeInstanceOf(ConflictError);
    await expect(c.calls.endByCustomer(customerId, callId)).rejects.toBeInstanceOf(ConflictError);
    // and a new call can start now
    await expect(c.calls.start(agent1, conversationId, { callType: "AUDIO" })).resolves.toMatchObject({
      status: "RINGING",
    });
  });

  it("lets a supervisor end any answered call, but not a stranger agent", async () => {
    const callId = await answeredCall();
    await expect(c.calls.end(agent2, callId)).rejects.toBeInstanceOf(NotFoundError); // hidden conversation
    await expect(c.calls.end(supervisor, callId)).resolves.toMatchObject({ status: "ENDED" });
  });

  it("the customer can decline or end; the caller can cancel a ringing call but nobody else", async () => {
    const declined = await c.calls.start(agent1, conversationId, { callType: "AUDIO" });
    await expect(c.calls.declineByCustomer(customerId, declined.id)).resolves.toMatchObject({ status: "DECLINED" });

    const cancelled = await c.calls.start(agent1, conversationId, { callType: "AUDIO" });
    await expect(c.calls.cancelByCustomer(customerId, cancelled.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(c.calls.cancel(supervisor, cancelled.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(c.calls.cancel(agent1, cancelled.id)).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(c.calls.cancel(agent1, cancelled.id)).rejects.toBeInstanceOf(ConflictError);

    const third = await c.calls.start(agent1, conversationId, { callType: "AUDIO" });
    await c.calls.acceptByCustomer(customerId, third.id);
    await expect(c.calls.endByCustomer(customerId, third.id)).resolves.toMatchObject({ status: "ENDED" });
    expect((await callActivities()).map((a) => a.metadata).map((m) => (m as { action: string }).action)).toEqual(
      expect.arrayContaining(["started", "declined", "cancelled", "answered", "ended"]),
    );
  });

  describe("a call from the customer", () => {
    it("alerts everyone who may see the conversation, and the first agent to answer wins", async () => {
      const incoming = await c.calls.initiateFromCustomer({ customerId, conversationId, callType: "AUDIO" });
      expect(incoming).toMatchObject({ status: "RINGING", initiatedBy: { type: "CUSTOMER", id: customerId } });
      const alert = c.published("call.incoming");
      expect(alert).toHaveLength(1);
      expect(alert[0]?.audience.kind).toBe("conversation");
      c.events.length = 0;

      // Another agent cannot see an owned conversation, so cannot answer; the owner and a supervisor race.
      await expect(c.calls.accept(agent2, incoming.id)).rejects.toBeInstanceOf(NotFoundError);
      const results = await Promise.allSettled([
        c.calls.accept(agent1, incoming.id),
        c.calls.accept(supervisor, incoming.id),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(loser.reason).toBeInstanceOf(ConflictError);

      const participants = await db.callParticipant.findMany({ where: { callId: incoming.id } });
      expect(participants.map((p) => p.participantType).sort()).toEqual(["AGENT", "CUSTOMER"]);
      expect(participants.every((p) => p.joinedAt !== null)).toBe(true);
    });

    it("the answering agent then receives the customer's offer path correctly: the customer is the caller", async () => {
      const incoming = await c.calls.initiateFromCustomer({ customerId, conversationId, callType: "AUDIO" });
      await c.calls.accept(agent1, incoming.id);
      c.events.length = 0;
      await c.calls.relay(C, "offer", sdp(incoming.id));
      await c.calls.relay(A1, "answer", sdp(incoming.id));
      expect(c.events.map((e) => [e.type, e.audience])).toEqual([
        ["call.offer", { kind: "users", userIds: [uid(1)] }],
        ["call.answer", { kind: "users", userIds: [customerId] }],
      ]);
      await expect(c.calls.relay(A1, "offer", sdp(incoming.id))).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("an agent who owns the chat can decline; a customer cannot call into someone else's conversation", async () => {
      const incoming = await c.calls.initiateFromCustomer({ customerId, conversationId, callType: "AUDIO" });
      await expect(c.calls.decline(agent1, incoming.id)).resolves.toMatchObject({ status: "DECLINED" });
      await expect(
        c.calls.initiateFromCustomer({ customerId: uid(555), conversationId, callType: "AUDIO" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("any agent can answer while nobody owns the conversation", async () => {
      const waiting = await makeConversation(2);
      const incoming = await c.calls.initiateFromCustomer({
        customerId: uid(102),
        conversationId: waiting,
        callType: "AUDIO",
      });
      await expect(c.calls.accept(agent2, incoming.id)).resolves.toMatchObject({ status: "ACTIVE" });
    });
  });

  it("history lists a conversation's calls newest first with the caller's permissions", async () => {
    const first = await c.calls.start(agent1, conversationId, { callType: "AUDIO" });
    await c.calls.cancel(agent1, first.id);
    const second = await c.calls.start(agent1, conversationId, { callType: "VIDEO" });

    const history = await c.calls.listForConversation(agent1, conversationId, { page: 1, size: 25 });
    expect(history.items.map((call) => call.id)).toEqual([second.id, first.id]);
    expect(history.items[0]?.permissions.canCancel).toBe(true);
    expect(history.items[1]?.permissions.canCancel).toBe(false);
    expect(history.meta.total).toBe(2);
    await expect(c.calls.listForConversation(agent2, conversationId, { page: 1, size: 25 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(c.calls.get(agent2, second.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  describe("the job", () => {
    it("marks an unanswered call missed after the ring timeout, frees the conversation, and tells the owner of a customer's call", async () => {
      const outgoing = await c.calls.start(agent1, conversationId, { callType: "AUDIO" });
      const justBefore = new Date(Date.now() + 40_000);
      expect(await c.calls.processDue(justBefore)).toEqual({ missed: 0, ended: 0 });

      const later = new Date(Date.now() + 50_000);
      expect(await c.calls.processDue(later)).toEqual({ missed: 1, ended: 0 });
      expect(await c.calls.processDue(later)).toEqual({ missed: 0, ended: 0 });
      expect((await c.calls.get(agent1, outgoing.id)).status).toBe("MISSED");
      expect(await db.notification.count({ where: { notificationType: "CALL" } })).toBe(0); // the agent rang out: nothing to report

      const incoming = await c.calls.initiateFromCustomer({ customerId, conversationId, callType: "AUDIO" });
      await c.calls.processDue(new Date(Date.now() + 50_000));
      expect((await c.calls.get(agent1, incoming.id)).status).toBe("MISSED");
      const notes = await db.notification.findMany({ where: { notificationType: "CALL" } });
      expect(notes.map((n) => [n.recipientId, n.title])).toEqual([[uid(1), "Missed call"]]);
      const system = await db.conversationActivity.findFirstOrThrow({
        where: { conversationId, activityType: "CALL", actorType: "SYSTEM" },
      });
      expect(system.actorId).toBeNull();
      await expect(c.calls.start(agent1, conversationId, { callType: "AUDIO" })).resolves.toBeDefined();
    });

    it("ends a call that was never finished", async () => {
      const callId = await answeredCall();
      expect(await c.calls.processDue(new Date(Date.now() + 3 * 60 * MIN))).toMatchObject({ ended: 0 });
      expect(await c.calls.processDue(new Date(Date.now() + 5 * 60 * MIN))).toMatchObject({ ended: 1 });
      const call = await c.calls.get(agent1, callId);
      expect(call.status).toBe("ENDED");
      expect(call.participants.every((p) => p.leftAt !== null)).toBe(true);
    });

    it("skips a call another instance is handling instead of waiting for it or taking it twice", async () => {
      const call = await c.calls.start(agent1, conversationId, { callType: "AUDIO" });
      const later = new Date(Date.now() + 60_000);
      let duringLock: { missed: number; ended: number } | "blocked" | undefined;

      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM calls WHERE id = ${call.id}::uuid FOR UPDATE`; // "another instance" holds it
        duringLock = await Promise.race([
          c.calls.processDue(later),
          new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 1500)),
        ]);
      });

      expect(duringLock).toEqual({ missed: 0, ended: 0 });
      expect(await c.calls.processDue(later)).toEqual({ missed: 1, ended: 0 }); // handled once the lock is gone
    });

    it("handles each call once when several instances run at the same time", async () => {
      for (let n = 0; n < 12; n++) {
        const conversation = await makeConversation(10 + n);
        await c.assignments.assign(agent1, conversation, {});
        await c.calls.start(agent1, conversation, { callType: "AUDIO" });
      }
      const later = new Date(Date.now() + 60_000);
      const runs = await Promise.all(Array.from({ length: 8 }, () => c.calls.processDue(later)));
      expect(runs.reduce((sum, r) => sum + r.missed, 0)).toBe(12);
      expect(await db.conversationActivity.count({ where: { activityType: "CALL", actorType: "SYSTEM" } })).toBe(12);
    });
  });
});
