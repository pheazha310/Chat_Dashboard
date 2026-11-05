import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, NotFoundError } from "@shared/errors/AppError.js";

/**
 * Runs the real repositories and services against PostgreSQL with the project's migration applied
 * (raw SQL, CHECK constraints, partial unique indexes and the owner-consistency trigger included).
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/chat_test pnpm --filter @chat-dashboard/backend test
 *
 * Skipped when the variable is not set. Every table is truncated, so the database name must contain "test".
 */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const agent1: AuthContext = { userId: 1n, role: "AGENT" };
const agent2: AuthContext = { userId: 2n, role: "AGENT" };
const supervisor: AuthContext = { userId: 9n, role: "SUPERVISOR" };

describe.skipIf(!url)("conversation flows on PostgreSQL", () => {
  let db: typeof import("@config/database.js").prisma;
  let conversations: import("../../conversations/conversation.service.js").ConversationService;
  let assignments: import("../assignment.service.js").AssignmentService;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    db = (await import("@config/database.js")).prisma;
    const { ConversationRepository } = await import("../../conversations/conversation.repository.js");
    const { ConversationService } = await import("../../conversations/conversation.service.js");
    const { AssignmentRepository } = await import("../assignment.repository.js");
    const { AssignmentService } = await import("../assignment.service.js");
    const { NotificationRepository, NotificationService } = await import("@modules/notifications/index.js");
    conversations = new ConversationService(new ConversationRepository());
    assignments = new AssignmentService(
      new AssignmentRepository(),
      new NotificationService(new NotificationRepository()),
    );
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags RESTART IDENTITY CASCADE`;
  });

  const create = async (customerId = 100n, applicationId: bigint | undefined = 7n, name = "Maya Chen") =>
    (
      await conversations.create(agent1, {
        customerId,
        ...(applicationId === undefined ? {} : { applicationId }),
        customerName: name,
        customerIdentifier: `C-${customerId}`,
        priority: "MEDIUM",
      })
    ).conversation;

  const addCustomerMessages = async (conversationId: bigint, count: number) => {
    for (let n = 1; n <= count; n++) {
      await db.message.create({
        data: { conversationId, sequenceNumber: BigInt(n), senderType: "CUSTOMER", senderId: 100n, content: `m${n}` },
      });
    }
    await db.conversation.update({ where: { id: conversationId }, data: { lastSequenceNumber: BigInt(count) } });
  };

  const openOwners = (conversationId: bigint) =>
    db.conversationAssignment.findMany({ where: { conversationId, endedAt: null, assignmentType: "OWNER" } });

  describe("creating", () => {
    it("persists a queued conversation and reuses the open one for the same application", async () => {
      const first = await create();
      expect(first).toMatchObject({ handoffStatus: "NEEDS_HUMAN", status: "OPEN", customerId: "100" });
      const again = await conversations.create(agent2, { customerId: 100n, applicationId: 7n, priority: "HIGH" });
      expect(again.created).toBe(false);
      expect(again.conversation.id).toBe(first.id);
      expect(await db.conversation.count()).toBe(1);
      expect(await db.conversationParticipant.count({ where: { participantType: "CUSTOMER" } })).toBe(1);
    });

    it("serializes concurrent creates for one application into a single conversation", async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          conversations.create(agent1, { customerId: 100n, applicationId: 7n, priority: "MEDIUM" }),
        ),
      );
      expect(new Set(results.map((r) => r.conversation.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
    });

    it("rejects an application that belongs to another customer", async () => {
      await create();
      await expect(
        conversations.create(agent1, { customerId: 200n, applicationId: 7n, priority: "LOW" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("inbox", () => {
    it("computes per-agent unread counts and the unread filter", async () => {
      const { id } = await create();
      const cid = BigInt(id);
      await addCustomerMessages(cid, 3);
      const query = { filter: "all", page: 1, size: 25 } as const;

      expect((await conversations.list(agent1, query)).items[0]?.unreadCount).toBe(3);
      await db.conversationRead.create({
        data: { conversationId: cid, readerType: "AGENT", readerId: 1n, lastReadSequenceNumber: 2n },
      });
      expect((await conversations.list(agent1, query)).items[0]?.unreadCount).toBe(1);
      expect((await conversations.list(agent2, query)).items[0]?.unreadCount).toBe(3); // per agent

      await db.conversationRead.updateMany({ data: { lastReadSequenceNumber: 3n } });
      expect((await conversations.list(agent1, { ...query, filter: "unread" })).items).toHaveLength(0);
      await db.conversationRead.updateMany({ data: { markedUnread: true } });
      const unread = await conversations.list(agent1, { ...query, filter: "unread" });
      expect(unread.items).toHaveLength(1);
      expect(unread.items[0]?.unreadCount).toBe(1);
    });

    it("applies Mine / Unassigned / Archived filters, search, status, priority and tags together", async () => {
      const a = await create(100n, 7n, "Maya Chen");
      const b = await create(101n, 8n, "Sokha Lim");
      await assignments.assign(agent1, BigInt(a.id), {});
      const tag = await db.tag.create({ data: { name: "vip" } });
      await db.conversationTag.create({ data: { conversationId: BigInt(b.id), tagId: tag.id } });
      await db.conversation.update({ where: { id: BigInt(b.id) }, data: { priority: "HIGH" } });
      const base = { page: 1, size: 25 } as const;
      const ids = async (auth: AuthContext, q: Parameters<typeof conversations.list>[1]) =>
        (await conversations.list(auth, q)).items.map((i) => i.id);

      expect(await ids(agent1, { ...base, filter: "mine" })).toEqual([a.id]);
      expect(await ids(agent1, { ...base, filter: "unassigned" })).toEqual([b.id]);
      expect(await ids(agent1, { ...base, filter: "all", q: "sokha" })).toEqual([b.id]);
      expect(await ids(agent1, { ...base, filter: "all", q: "C-100" })).toEqual([a.id]);
      expect(await ids(agent1, { ...base, filter: "all", q: "101" })).toEqual([b.id]);
      expect(await ids(agent1, { ...base, filter: "all", priority: "HIGH", tag: tag.id })).toEqual([b.id]);
      expect(await ids(agent1, { ...base, filter: "all", priority: "LOW" })).toEqual([]);

      await conversations.archive(agent1, BigInt(a.id));
      expect(await ids(agent1, { ...base, filter: "archived" })).toEqual([a.id]);
      expect(await ids(agent1, { ...base, filter: "all" })).toEqual([b.id]);
      const restored = await conversations.restore(agent1, BigInt(a.id));
      expect(restored.isArchived).toBe(false);
    });

    it("orders by recent activity and paginates", async () => {
      for (let n = 0; n < 3; n++) await create(100n + BigInt(n), 7n + BigInt(n));
      await db.conversation.update({ where: { id: 1n }, data: { lastMessageAt: new Date(Date.now() + 60_000) } });
      const page1 = await conversations.list(agent1, { filter: "all", page: 1, size: 2 });
      expect(page1.items.map((i) => i.id)).toEqual(["1", "3"]);
      expect(page1.meta).toEqual({ total: 3, page: 1, size: 2, totalPages: 2 });
      expect((await conversations.list(agent1, { filter: "all", page: 2, size: 2 })).items.map((i) => i.id)).toEqual([
        "2",
      ]);
    });

    it("hides another agent's assigned conversation from search and detail, but not from a supervisor", async () => {
      const { id } = await create();
      await assignments.assign(agent1, BigInt(id), {});
      const q = { filter: "all", page: 1, size: 25, q: "maya" } as const;
      expect((await conversations.list(agent2, q)).items).toHaveLength(0);
      await expect(conversations.get(agent2, BigInt(id))).rejects.toBeInstanceOf(NotFoundError);
      expect((await conversations.list(supervisor, q)).items).toHaveLength(1);
      expect((await conversations.get(agent1, BigInt(id))).permissions.canSendMessage).toBe(true);
    });
  });

  describe("assignment", () => {
    it("lets exactly one of two simultaneous takeovers win", async () => {
      const { id } = await create();
      const cid = BigInt(id);
      const results = await Promise.allSettled([
        assignments.assign(agent1, cid, {}),
        assignments.assign(agent2, cid, {}),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const loser = results.find((r) => r.status === "rejected");
      expect(loser?.status === "rejected" && loser.reason).toBeInstanceOf(ConflictError);

      const owners = await openOwners(cid);
      expect(owners).toHaveLength(1);
      const row = await db.conversation.findUniqueOrThrow({ where: { id: cid } });
      expect(row).toMatchObject({
        handoffStatus: "ASSIGNED",
        conversationMode: "HUMAN",
        assignedAgentId: owners[0]?.agentId,
      });
      expect(await db.conversationActivity.count({ where: { conversationId: cid, activityType: "ASSIGNED" } })).toBe(1);
    });

    it("keeps full history across assign, transfer and unassign, and keeps the DB mirror consistent", async () => {
      const { id } = await create();
      const cid = BigInt(id);
      await assignments.assign(agent1, cid, {});
      await assignments.transfer(agent1, cid, { agentId: 2n, note: "shift change" });
      expect((await db.conversation.findUniqueOrThrow({ where: { id: cid } })).assignedAgentId).toBe(2n);
      await expect(assignments.unassign(agent1, cid, {})).rejects.toThrow(); // agent1 no longer owns it
      await assignments.unassign(agent2, cid, {});

      const row = await db.conversation.findUniqueOrThrow({ where: { id: cid } });
      expect(row).toMatchObject({ handoffStatus: "NEEDS_HUMAN", assignedAgentId: null });
      expect(await openOwners(cid)).toHaveLength(0);

      const history = await assignments.history(supervisor, cid);
      expect(history.map((h) => [h.agentId, h.action, h.endedAt !== null])).toEqual([
        ["2", "TRANSFERRED", true],
        ["1", "TAKEOVER", true],
      ]);
      expect(history[0]?.note).toBe("shift change");
      const activities = await db.conversationActivity.findMany({
        where: { conversationId: cid },
        orderBy: { id: "asc" },
      });
      expect(activities.map((a) => a.activityType)).toEqual(["ASSIGNED", "TRANSFERRED", "UNASSIGNED"]);
    });

    it("notifies the assignee, honouring notification preferences", async () => {
      const { id } = await create();
      await assignments.assign(supervisor, BigInt(id), { agentId: 3n });
      const notes = await db.notification.findMany();
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        recipientType: "AGENT",
        recipientId: 3n,
        notificationType: "ASSIGNED",
        readAt: null,
      });

      await db.notificationPreference.create({ data: { agentId: 4n, transferEnabled: false } });
      await assignments.transfer(supervisor, BigInt(id), { agentId: 4n });
      expect(await db.notification.count({ where: { recipientId: 4n } })).toBe(0);
    });
  });

  describe("status changes", () => {
    it("resolve releases the owner, records the change, and reopen puts the chat back in the queue", async () => {
      const { id } = await create();
      const cid = BigInt(id);
      await assignments.assign(agent1, cid, {});

      const resolved = await conversations.changeStatus(agent1, cid, "RESOLVED");
      expect(resolved).toMatchObject({ status: "RESOLVED", handoffStatus: "NONE", assignedAgentId: null });
      expect(resolved.resolvedAt).not.toBeNull();
      expect(await openOwners(cid)).toHaveLength(0);
      expect(
        (await db.conversationParticipant.findFirst({ where: { participantId: 1n, participantType: "AGENT" } }))
          ?.leftAt,
      ).not.toBeNull();

      const reopened = await conversations.changeStatus(agent2, cid, "OPEN");
      expect(reopened).toMatchObject({
        status: "OPEN",
        handoffStatus: "NEEDS_HUMAN",
        resolvedAt: null,
        closedAt: null,
      });
      const log = await db.conversationActivity.findMany({
        where: { activityType: "STATUS_CHANGED" },
        orderBy: { id: "asc" },
      });
      expect(log.map((a) => a.metadata)).toEqual([
        { from: "OPEN", to: "RESOLVED" },
        { from: "RESOLVED", to: "OPEN" },
      ]);
      expect(await db.message.count({ where: { conversationId: cid } })).toBe(0); // history untouched
    });

    it("closing frees the application for a new conversation", async () => {
      const first = await create();
      await conversations.changeStatus(supervisor, BigInt(first.id), "CLOSED");
      const second = await conversations.create(agent1, { customerId: 100n, applicationId: 7n, priority: "MEDIUM" });
      expect(second.created).toBe(true);
      expect(second.conversation.id).not.toBe(first.id);
    });

    it("rejects a second simultaneous resolve", async () => {
      const { id } = await create();
      await assignments.assign(agent1, BigInt(id), {});
      const results = await Promise.allSettled([
        conversations.changeStatus(agent1, BigInt(id), "RESOLVED"),
        conversations.changeStatus(supervisor, BigInt(id), "RESOLVED"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.conversationActivity.count({ where: { activityType: "STATUS_CHANGED" } })).toBe(1);
    });
  });
});
