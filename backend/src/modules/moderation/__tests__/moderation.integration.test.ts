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
const customerId = uid(101);

describe.skipIf(!url)("moderation on PostgreSQL", () => {
  let db: typeof import("@config/database.js").prisma;
  let c: Awaited<ReturnType<typeof createTestContainer>>;
  let conversationId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    c = await createTestContainer();
    await c.identify(agent1, agent2, supervisor);
  });
  afterAll(async () => {
    // Other test files share this database and use the same customer ids: leave no block or keyword behind.
    if (db) await db.$executeRaw`TRUNCATE customer_blocks, spam_reports, blocked_keywords, moderation_activities`;
    await db?.$disconnect();
  });

  const makeConversation = async (n: number) =>
    (
      await c.conversations.create(agent1, {
        customerId: uid(100 + n),
        applicationId: 200 + n,
        customerName: `Customer ${n}`,
        priority: "MEDIUM",
      })
    ).conversation.id;

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, customer_blocks, spam_reports, blocked_keywords, moderation_activities RESTART IDENTITY CASCADE`;
    conversationId = await makeConversation(1);
    await c.assignments.assign(agent1, conversationId, {});
    c.events.length = 0;
  });

  const customerSays = (text: string, clientId = `c-${Math.random()}`) =>
    c.messages.receiveFromCustomer({ customerId, conversationId, clientId, text });
  const log = (action: string) => db.moderationActivity.findMany({ where: { action } });
  const timeline = () => db.conversationActivity.findMany({ where: { conversationId, activityType: "MODERATION" } });

  describe("blocking customers", () => {
    it("the owner blocks the conversation's customer; it is logged, on the timeline, and announced", async () => {
      const block = await c.moderation.blockFromConversation(agent1, conversationId, { reason: "abusive language" });

      expect(block).toMatchObject({ customerId, blockedBy: uid(1), reason: "abusive language", unblockedAt: null });
      expect(block.customerName).toBeTruthy(); // from the (dev) directory
      expect(await c.moderation.isBlocked(customerId)).toBe(true);
      expect((await log("BLOCK_CUSTOMER"))[0]).toMatchObject({
        actorId: uid(1),
        targetType: "CUSTOMER",
        targetId: customerId,
      });
      expect((await timeline()).map((a) => a.description)).toEqual(["Customer blocked"]);
      expect(c.published("customer.blocked")).toHaveLength(1);
    });

    it("only the owner or a supervisor may, and a hidden conversation is not found", async () => {
      await expect(c.moderation.blockFromConversation(agent2, conversationId, {})).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await db.conversationAssignment.create({
        data: {
          conversationId,
          agentId: uid(2),
          assignmentType: "VIEWER",
          assignmentAction: "ASSIGNED",
          assignedBy: uid(1),
        },
      });
      await expect(c.moderation.blockFromConversation(agent2, conversationId, {})).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(c.moderation.blockCustomer(agent1, customerId, {})).rejects.toBeInstanceOf(ForbiddenError);
      expect(await db.customerBlock.count()).toBe(0);
      await expect(c.moderation.blockFromConversation(supervisor, conversationId, {})).resolves.toBeDefined();
    });

    it("blocks a customer once, also under simultaneous attempts, and the database agrees", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => c.moderation.blockCustomer(supervisor, customerId, {})),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
      expect(await db.customerBlock.count({ where: { unblockedAt: null } })).toBe(1);
      await expect(db.customerBlock.create({ data: { customerId, blockedBy: uid(9) } })).rejects.toThrow();
    });

    it("stops a blocked customer's messages and calls, and lets them back in once unblocked", async () => {
      await customerSays("hello", "first");
      await c.moderation.blockFromConversation(agent1, conversationId, {});
      const before = await db.message.count();

      await expect(customerSays("let me in")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        c.calls.initiateFromCustomer({ customerId, conversationId, callType: "AUDIO" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await db.message.count()).toBe(before);
      expect(await db.call.count()).toBe(0);

      // agents can still write to the conversation
      await expect(
        c.messages.send(agent1, conversationId, { clientId: "a1", text: "We have paused your account." }),
      ).resolves.toBeDefined();

      await c.moderation.unblock(agent1, customerId);
      await expect(customerSays("thanks")).resolves.toBeDefined();
      expect(await c.moderation.isBlocked(customerId)).toBe(false);
      expect(await log("UNBLOCK_CUSTOMER")).toHaveLength(1);
    });

    it("lets the blocker or a supervisor unblock, and tells nobody else the customer is blocked", async () => {
      await c.moderation.blockFromConversation(agent1, conversationId, {});
      await expect(c.moderation.unblock(agent2, customerId)).rejects.toBeInstanceOf(NotFoundError);
      expect(await c.moderation.isBlocked(customerId)).toBe(true);
      await expect(c.moderation.unblock(supervisor, customerId)).resolves.toMatchObject({ unblockedBy: uid(9) });
      await expect(c.moderation.unblock(supervisor, customerId)).rejects.toBeInstanceOf(NotFoundError);
      await c.moderation.blockCustomer(supervisor, customerId, {}); // can be blocked again
      expect(await db.customerBlock.count()).toBe(2);
    });

    it("lists current and lifted blocks: all for a supervisor, one's own for an agent", async () => {
      await c.moderation.blockFromConversation(agent1, conversationId, {});
      const second = await makeConversation(2);
      await c.moderation.blockCustomer(supervisor, uid(102), { reason: "spam" });
      void second;

      expect((await c.moderation.listBlocks(supervisor, { page: 1, size: 25, active: true })).meta.total).toBe(2);
      const mine = await c.moderation.listBlocks(agent1, { page: 1, size: 25, active: true });
      expect(mine.items.map((b) => b.customerId)).toEqual([customerId]);
      expect(mine.items[0]?.permissions.canUnblock).toBe(true);

      await c.moderation.unblock(supervisor, uid(102));
      expect((await c.moderation.listBlocks(supervisor, { page: 1, size: 25, active: false })).items).toHaveLength(1);
    });
  });

  describe("blocked keywords", () => {
    it("keeps a matching customer message and flags it, without repeating the keyword", async () => {
      await c.moderation.createKeyword(supervisor, "Wire Transfer");
      c.events.length = 0;

      const flagged = await customerSays("Please send a WIRE TRANSFER to my cousin", "k1");
      const clean = await customerSays("What is my balance?", "k2");

      expect(flagged.created).toBe(true); // stored, not rejected
      expect(await db.message.count({ where: { conversationId, senderType: "CUSTOMER" } })).toBe(2);
      const entries = await timeline();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorType: "SYSTEM", description: "Message matched a blocked keyword" });
      expect(entries[0]?.metadata).toEqual({ messageId: flagged.message.id, matches: 1 });
      expect(JSON.stringify(entries)).not.toMatch(/wire transfer/i);
      const events = c.published("message.flagged");
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({ messageId: flagged.message.id, matches: 1 });
      void clean;
    });

    it("applies a switched-off or removed keyword at once on this instance", async () => {
      const keyword = await c.moderation.createKeyword(supervisor, "scam");
      await customerSays("a scam", "a");
      expect(await timeline()).toHaveLength(1);

      await c.moderation.updateKeyword(supervisor, keyword.id, { isActive: false });
      await customerSays("another scam", "b");
      expect(await timeline()).toHaveLength(1);

      await c.moderation.updateKeyword(supervisor, keyword.id, { isActive: true });
      await customerSays("one more scam", "c");
      expect(await timeline()).toHaveLength(2);

      await c.moderation.deleteKeyword(supervisor, keyword.id);
      await customerSays("scam scam", "d");
      expect(await timeline()).toHaveLength(2);
      const kept = (await c.moderation.listKeywords({ page: 1, size: 10 })).items;
      expect(kept).toEqual([expect.objectContaining({ id: keyword.id, keyword: "scam", isActive: false })]);
      expect((await log("REMOVE_KEYWORD"))[0]?.metadata).toEqual({ keyword: "scam" });
    });

    it("stores each keyword once ignoring case, also under simultaneous requests, for supervisors only", async () => {
      await expect(c.moderation.createKeyword(agent1, "x")).rejects.toBeInstanceOf(ForbiddenError);
      const results = await Promise.allSettled(
        ["Scam", "scam", "SCAM", "sCaM"].map((text) => c.moderation.createKeyword(supervisor, text)),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
      expect(await db.blockedKeyword.count()).toBe(1);
    });

    it("lists keywords for every agent, with search that treats % and _ as plain text", async () => {
      await c.moderation.createKeyword(supervisor, "100% free");
      await c.moderation.createKeyword(supervisor, "free money");
      await c.moderation.createKeyword(supervisor, "win_big");
      const all = await c.moderation.listKeywords({ page: 1, size: 25 });
      expect(all.items.map((k) => k.keyword)).toEqual(["100% free", "free money", "win_big"]);
      expect((await c.moderation.listKeywords({ page: 1, size: 25, q: "%" })).items.map((k) => k.keyword)).toEqual([
        "100% free",
      ]);
      expect((await c.moderation.listKeywords({ page: 1, size: 25, q: "_" })).items.map((k) => k.keyword)).toEqual([
        "win_big",
      ]);
    });
  });

  describe("spam reports", () => {
    it("an agent reports a message; only that reporter's duplicate is refused, also when simultaneous", async () => {
      const said = await customerSays("buy now!!!", "m1");
      const messageId = said.message.id;

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => c.moderation.report(agent1, conversationId, { reason: "spam", messageId })),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
      expect(await db.spamReport.count()).toBe(1);
      expect(c.published("spam.reported").length).toBeGreaterThanOrEqual(1);

      await expect(
        c.moderation.report(supervisor, conversationId, { reason: "also spam", messageId }),
      ).resolves.toMatchObject({
        reportedBy: { type: "AGENT", id: uid(9) },
      });
      await expect(c.moderation.report(agent1, conversationId, { reason: "general" })).resolves.toBeDefined();
      expect(await db.spamReport.count()).toBe(3);
    });

    it("rejects a message from another conversation and a conversation the reporter cannot see", async () => {
      const other = await makeConversation(2);
      await c.assignments.assign(agent1, other, {});
      const elsewhere = await c.messages.receiveFromCustomer({
        customerId: uid(102),
        conversationId: other,
        clientId: "x",
        text: "hi",
      });
      await expect(
        c.moderation.report(agent1, conversationId, { reason: "spam", messageId: elsewhere.message.id }),
      ).rejects.toBeInstanceOf(BadRequestError);
      await expect(c.moderation.report(agent2, conversationId, { reason: "spam" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(await db.spamReport.count()).toBe(0);
    });

    it("a customer can report too, through the customer channel's entry point", async () => {
      const report = await c.moderation.reportByCustomer(customerId, conversationId, { reason: "agent was rude" });
      expect(report.reportedBy).toEqual({ type: "CUSTOMER", id: customerId });
      await expect(
        c.moderation.reportByCustomer(customerId, conversationId, { reason: "again" }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(c.moderation.reportByCustomer(uid(555), conversationId, { reason: "x" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("a supervisor confirms a report and blocks the customer in the same step; it cannot be reviewed twice", async () => {
      const report = await c.moderation.report(agent1, conversationId, { reason: "phishing links" });
      await expect(c.moderation.review(agent1, report.id, { status: "CONFIRMED" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      const results = await Promise.allSettled([
        c.moderation.review(supervisor, report.id, {
          status: "CONFIRMED",
          blockCustomer: true,
          resolutionNote: "confirmed",
        }),
        c.moderation.review(supervisor, report.id, { status: "DISMISSED" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const stored = await db.spamReport.findUniqueOrThrow({ where: { id: report.id } });
      expect(stored.status).not.toBe("PENDING");

      if (stored.status === "CONFIRMED") {
        expect(await c.moderation.isBlocked(customerId)).toBe(true);
        expect(stored.resolutionNote).toBe("confirmed");
        expect(c.published("customer.blocked")).toHaveLength(1);
      } else {
        expect(await c.moderation.isBlocked(customerId)).toBe(false);
      }
      await expect(c.moderation.review(supervisor, report.id, { status: "DISMISSED" })).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("rolls the block back when the report was already reviewed", async () => {
      const report = await c.moderation.report(agent1, conversationId, { reason: "spam" });
      await c.moderation.review(supervisor, report.id, { status: "DISMISSED" });
      await expect(
        c.moderation.review(supervisor, report.id, { status: "CONFIRMED", blockCustomer: true }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(await c.moderation.isBlocked(customerId)).toBe(false);
    });

    it("shows a supervisor the whole queue and an agent only their own reports", async () => {
      await c.moderation.report(agent1, conversationId, { reason: "mine" });
      await c.moderation.report(supervisor, conversationId, { reason: "theirs" });
      expect((await c.moderation.listReports(supervisor, { page: 1, size: 25, status: "PENDING" })).meta.total).toBe(2);
      const own = await c.moderation.listReports(agent1, { page: 1, size: 25 });
      expect(own.items.map((r) => r.reason)).toEqual(["mine"]);
      const forConversation = await c.moderation.listReportsForConversation(agent1, conversationId, {
        page: 1,
        size: 25,
      });
      expect(forConversation.meta.total).toBe(2);
      await expect(
        c.moderation.listReportsForConversation(agent2, conversationId, { page: 1, size: 25 }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("the database allows one pending report per reporter and target", async () => {
      await c.moderation.report(agent1, conversationId, { reason: "spam" });
      await expect(
        db.spamReport.create({
          data: { conversationId, reportedByType: "AGENT", reportedById: uid(1), reason: "again" },
        }),
      ).rejects.toThrow();
    });
  });

  it("keeps an audit log supervisors can read and filter", async () => {
    await c.moderation.createKeyword(supervisor, "scam");
    await c.moderation.blockFromConversation(agent1, conversationId, {});
    const report = await c.moderation.report(agent1, conversationId, { reason: "spam" });
    await c.moderation.review(supervisor, report.id, { status: "DISMISSED" });

    const all = await c.moderation.listActivities(supervisor, { page: 1, size: 25 });
    expect(all.items.map((a) => a.action).sort()).toEqual(
      ["ADD_KEYWORD", "BLOCK_CUSTOMER", "DISMISS_SPAM", "REPORT_SPAM"].sort(),
    );
    expect(
      (await c.moderation.listActivities(supervisor, { page: 1, size: 25, targetType: "KEYWORD" })).items,
    ).toHaveLength(1);
    expect((await c.moderation.listActivities(supervisor, { page: 1, size: 25, actorId: uid(1) })).meta.total).toBe(2);
    await expect(c.moderation.listActivities(agent1, { page: 1, size: 25 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
