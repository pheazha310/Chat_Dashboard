import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase, createTestContainer } from "../../../__tests__/support/container.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";

/** Real repositories and services on PostgreSQL. Needs TEST_DATABASE_URL (see conversation-flow.integration.test.ts). */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const agent1: AuthContext = { userId: 1n, role: "AGENT" };
const agent2: AuthContext = { userId: 2n, role: "AGENT" };
const CUSTOMER = 100n;

describe.skipIf(!url)("messaging on PostgreSQL", () => {
  let db: typeof import("@config/database.js").prisma;
  let conversations: import("../../../container.js").Container["conversations"];
  let assignments: import("../../../container.js").Container["assignments"];
  let messages: import("../../../container.js").Container["messages"];
  let cid: bigint;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    const container = await createTestContainer();
    messages = container.messages;
    conversations = container.conversations;
    assignments = container.assignments;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags RESTART IDENTITY CASCADE`;
    const { conversation } = await conversations.create(agent1, {
      customerId: CUSTOMER,
      applicationId: 7n,
      customerName: "Maya Chen",
      priority: "MEDIUM",
    });
    cid = BigInt(conversation.id);
  });

  const takeOver = () => assignments.assign(agent1, cid, {});
  const customerSays = (n: number) =>
    messages.receiveFromCustomer({ customerId: CUSTOMER, conversationId: cid, clientId: `cust-${n}`, text: `hi ${n}` });
  const unread = async (auth: AuthContext) =>
    (await conversations.list(auth, { filter: "all", page: 1, size: 25 })).items[0]?.unreadCount;
  const chat = () =>
    db.message.findMany({
      where: { conversationId: cid, senderType: { not: "SYSTEM" } },
      orderBy: { sequenceNumber: "asc" },
    });

  describe("sending", () => {
    it("persists the message and updates the inbox preview and counters", async () => {
      await takeOver();
      const { message, created } = await messages.send(agent1, cid, { clientId: "a1", text: "Hello Maya" });
      expect(created).toBe(true);
      expect(message).toMatchObject({
        senderType: "AGENT",
        senderId: "1",
        type: "TEXT",
        content: "Hello Maya",
        status: "SENT",
      });

      const row = await db.conversation.findUniqueOrThrow({ where: { id: cid } });
      expect(row.lastMessagePreview).toBe("Hello Maya");
      expect(row.lastSequenceNumber).toBe(BigInt(message.sequenceNumber)); // takeover's SYSTEM message came first
      expect(row.lastMessageAt.getTime()).toBe(new Date(message.createdAt).getTime()); // one database instant
    });

    it("does not create a duplicate when the client retries with the same clientId", async () => {
      await takeOver();
      const first = await messages.send(agent1, cid, { clientId: "retry", text: "once" });
      const again = await messages.send(agent1, cid, { clientId: "retry", text: "once" });
      expect(again.created).toBe(false);
      expect(again.message.id).toBe(first.message.id);
      expect(await db.message.count({ where: { clientId: "retry" } })).toBe(1);
    });

    it("keeps one message and distinct ordered sequences under concurrent sends and retries", async () => {
      await takeOver();
      const base = Number((await db.conversation.findUniqueOrThrow({ where: { id: cid } })).lastSequenceNumber);
      const distinct = Array.from({ length: 10 }, (_, n) =>
        messages.send(agent1, cid, { clientId: `d${n}`, text: `m${n}` }),
      );
      const retries = Array.from({ length: 5 }, () => messages.send(agent1, cid, { clientId: "same", text: "x" }));
      const results = await Promise.all([...distinct, ...retries]);

      expect(results.filter((r) => r.message.clientId === "same" && r.created)).toHaveLength(1);
      const sequences = (
        await db.message.findMany({ where: { conversationId: cid }, orderBy: { sequenceNumber: "asc" } })
      ).map((m) => Number(m.sequenceNumber));
      expect(sequences).toEqual(Array.from({ length: base + 11 }, (_, n) => n + 1)); // contiguous, no gaps or repeats
    });

    it("only the owner can send, others see 403 or 404, and a resolved chat refuses messages", async () => {
      await expect(messages.send(agent1, cid, { clientId: "x", text: "no owner yet" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await takeOver();
      await expect(messages.send(agent2, cid, { clientId: "x", text: "hi" })).rejects.toBeInstanceOf(NotFoundError);
      await conversations.changeStatus(agent1, cid, "RESOLVED");
      await expect(messages.send(agent1, cid, { clientId: "y", text: "late" })).rejects.toBeInstanceOf(ForbiddenError);
      expect(await chat()).toHaveLength(0);
    });

    it("rejects a reply to a message from another conversation", async () => {
      await takeOver();
      const other = (await conversations.create(agent1, { customerId: 200n, applicationId: 8n, priority: "LOW" }))
        .conversation;
      await assignments.assign(agent1, BigInt(other.id), {});
      const foreign = await messages.send(agent1, BigInt(other.id), { clientId: "f", text: "elsewhere" });
      await expect(
        messages.send(agent1, cid, { clientId: "r", text: "reply", replyToMessageId: BigInt(foreign.message.id) }),
      ).rejects.toBeInstanceOf(BadRequestError);
      const ok = await messages.send(agent1, cid, { clientId: "ok", text: "first" });
      const reply = await messages.send(agent1, cid, {
        clientId: "r2",
        text: "reply",
        replyToMessageId: BigInt(ok.message.id),
      });
      expect(reply.message.replyToMessageId).toBe(ok.message.id);
    });

    it("stores emoji-heavy text and a clean preview", async () => {
      await takeOver();
      await messages.send(agent1, cid, { clientId: "e", text: "😀".repeat(300) });
      const row = await db.conversation.findUniqueOrThrow({ where: { id: cid } });
      expect(Array.from(row.lastMessagePreview ?? "")).toHaveLength(255);
    });

    it("SYSTEM messages take a sequence number but leave the preview and activity time alone", async () => {
      await takeOver();
      await messages.send(agent1, cid, { clientId: "a", text: "visible" });
      const before = await db.conversation.findUniqueOrThrow({ where: { id: cid } });
      await messages.post(cid, "note", { event: "x" });
      const after = await db.conversation.findUniqueOrThrow({ where: { id: cid } });
      expect(after.lastSequenceNumber).toBe(before.lastSequenceNumber + 1n);
      expect(after.lastMessagePreview).toBe("visible");
      expect(after.lastMessageAt).toEqual(before.lastMessageAt);
    });
  });

  describe("customer messages", () => {
    it("reopens a resolved conversation, records it, notifies the owner, and is idempotent", async () => {
      await takeOver();
      await conversations.changeStatus(agent1, cid, "RESOLVED");
      const result = await customerSays(1);
      expect(result.created).toBe(true);
      const row = await db.conversation.findUniqueOrThrow({ where: { id: cid } });
      expect(row).toMatchObject({ status: "OPEN", resolvedAt: null, closedAt: null, lastMessagePreview: "hi 1" });
      const reason = await db.conversationActivity.findFirst({ where: { actorType: "CUSTOMER" } });
      expect(reason?.metadata).toMatchObject({ from: "RESOLVED", to: "OPEN", reason: "customer_message" });

      expect((await customerSays(1)).created).toBe(false);
      expect(await db.message.count({ where: { senderType: "CUSTOMER" } })).toBe(1);
    });

    it("notifies the owning agent of a new message unless the conversation is muted", async () => {
      await takeOver();
      await customerSays(1);
      expect(await db.notification.count({ where: { notificationType: "NEW_MESSAGE", recipientId: 1n } })).toBe(1);
      await db.conversationNotificationSetting.create({ data: { conversationId: cid, agentId: 1n, isMuted: true } });
      await customerSays(2);
      expect(await db.notification.count({ where: { notificationType: "NEW_MESSAGE" } })).toBe(1);
    });

    it("rejects another customer's conversation", async () => {
      await expect(
        messages.receiveFromCustomer({ customerId: 999n, conversationId: cid, clientId: "z", text: "x" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("history and sync", () => {
    const seed = async (count: number) => {
      await takeOver();
      for (let n = 1; n <= count; n++) await messages.send(agent1, cid, { clientId: `h${n}`, text: `t${n}` });
    };
    const texts = (items: { content: string | null }[]) => items.map((m) => m.content);

    it("pages backwards from the newest, oldest-to-newest within each page, without gaps or repeats", async () => {
      await seed(12);
      const first = await messages.history(agent1, cid, { limit: 5 });
      expect(texts(first.items)).toEqual(["t8", "t9", "t10", "t11", "t12"]);
      expect(first.meta.hasMore).toBe(true);

      const second = await messages.history(agent1, cid, {
        limit: 5,
        before: BigInt(first.meta.oldestSequence as string),
      });
      expect(texts(second.items)).toEqual(["t3", "t4", "t5", "t6", "t7"]);
      const last = await messages.history(agent1, cid, {
        limit: 50,
        before: BigInt(second.meta.oldestSequence as string),
      });
      expect(texts(last.items)).toEqual(["Agent 1 took over the conversation", "t1", "t2"]);
      expect(last.meta.hasMore).toBe(false);
    });

    it("returns exactly the missed messages after a reconnect", async () => {
      await seed(3);
      const seen = (await messages.history(agent1, cid, { limit: 50 })).meta.newestSequence as string;
      await customerSays(1);
      await customerSays(2);
      const missed = await messages.history(agent1, cid, { limit: 50, after: BigInt(seen) });
      expect(texts(missed.items)).toEqual(["hi 1", "hi 2"]);
      expect(missed.meta).toMatchObject({ hasMore: false, direction: "newer" });
      expect(
        (await messages.history(agent1, cid, { limit: 50, after: BigInt(missed.meta.newestSequence as string) })).items,
      ).toEqual([]);
    });

    it("excludes soft-deleted messages and hides the thread from agents who cannot see it", async () => {
      await seed(2);
      await db.message.updateMany({ where: { content: "t1" }, data: { deletedAt: new Date(), deletedBy: 1n } });
      expect(texts((await messages.history(agent1, cid, { limit: 50 })).items)).not.toContain("t1");
      await expect(messages.history(agent2, cid, { limit: 50 })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("read, unread and receipts", () => {
    it("tracks unread per agent and clears it for the agent who read", async () => {
      await takeOver();
      await customerSays(1);
      await customerSays(2);
      await customerSays(3);
      expect(await unread(agent1)).toBe(3);
      // Per agent: a supervisor has their own position and still sees all three.
      await db.conversationRead.create({
        data: { conversationId: cid, readerType: "AGENT", readerId: 9n, lastReadSequenceNumber: 0n },
      });
      expect(await unread({ userId: 9n, role: "SUPERVISOR" })).toBe(3);

      const state = await messages.markRead(agent1, cid);
      expect(state).toMatchObject({ unreadCount: 0, markedUnread: false });
      expect(await unread(agent1)).toBe(0);
    });

    it("records delivered and read receipts and marks customer messages READ", async () => {
      await takeOver();
      await customerSays(1);
      await customerSays(2);
      const [first] = await chat();
      await messages.markDelivered(agent1, cid, first!.id);
      expect((await db.message.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe("DELIVERED");

      await messages.markRead(agent1, cid);
      const receipts = await db.messageReceipt.findMany({ orderBy: { messageId: "asc" } });
      expect(receipts).toHaveLength(2);
      for (const r of receipts) {
        expect(r).toMatchObject({ recipientType: "AGENT", recipientId: 1n });
        expect(r.readAt).not.toBeNull();
        expect(r.deliveredAt).not.toBeNull();
      }
      expect((await chat()).map((m) => m.status)).toEqual(["READ", "READ"]);

      // A late delivery receipt must never downgrade READ.
      await messages.markDelivered(agent1, cid, first!.id);
      expect((await db.message.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe("READ");
    });

    it("never moves the read position backwards, so an older tab cannot resurrect unread messages", async () => {
      await takeOver();
      await customerSays(1);
      await customerSays(2);
      const [m1] = await chat();
      await messages.markRead(agent1, cid);
      const state = await messages.markRead(agent1, cid, m1!.id);
      expect(state.unreadCount).toBe(0);
      const read = await db.conversationRead.findFirstOrThrow({ where: { conversationId: cid, readerId: 1n } });
      expect(read.lastReadSequenceNumber).toBe((await chat())[1]!.sequenceNumber);
    });

    it("marks a conversation unread without inflating the count, shows it in the unread filter, and clears on read", async () => {
      await takeOver();
      await customerSays(1);
      await messages.markRead(agent1, cid);
      expect((await conversations.list(agent1, { filter: "unread", page: 1, size: 25 })).items).toHaveLength(0);

      const flagged = await messages.markUnread(agent1, cid);
      expect(flagged).toMatchObject({ markedUnread: true, unreadCount: 1 });
      expect((await conversations.list(agent1, { filter: "unread", page: 1, size: 25 })).items).toHaveLength(1);
      expect(await unread(agent1)).toBe(1);

      expect(await messages.markRead(agent1, cid)).toMatchObject({ markedUnread: false, unreadCount: 0 });
    });

    it("marking unread with no earlier read state keeps the real unread messages unread", async () => {
      await takeOver();
      await customerSays(1);
      await customerSays(2);
      await customerSays(3);
      const state = await messages.markUnread(agent1, cid);
      expect(state.unreadCount).toBe(3); // nothing was read yet, so all three stay unread (not reset, not inflated)
      await messages.markRead(agent1, cid);
      expect((await messages.markUnread(agent1, cid)).unreadCount).toBe(1); // read everything, then flagged: one
    });

    it("lets agents record receipts only for themselves, on messages they can see", async () => {
      await takeOver();
      await customerSays(1);
      const [m] = await chat();
      await expect(messages.markDelivered(agent2, cid, m!.id)).rejects.toBeInstanceOf(NotFoundError); // hidden chat
      await expect(messages.markRead(agent2, cid)).rejects.toBeInstanceOf(NotFoundError);
      const own = await messages.send(agent1, cid, { clientId: "mine", text: "x" });
      await expect(messages.markDelivered(agent1, cid, BigInt(own.message.id))).rejects.toBeInstanceOf(BadRequestError);
      expect(await db.messageReceipt.count()).toBe(0);
    });
  });
});
