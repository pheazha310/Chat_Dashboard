import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase, createTestContainer } from "../../../__tests__/support/container.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import { uid } from "../../../__tests__/support/ids.js";

/** Real repositories and services on PostgreSQL. Needs TEST_DATABASE_URL (see conversation-flow.integration.test.ts). */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const agent1: AuthContext = { userId: uid(1), role: "AGENT" };
const agent2: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const CUSTOMER = uid(100);

describe.skipIf(!url)("message actions on PostgreSQL", () => {
  let db: typeof import("@config/database.js").prisma;
  let c: Awaited<ReturnType<typeof createTestContainer>>;
  let cid: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    c = await createTestContainer();
    await c.identify(agent1, agent2, supervisor);
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags RESTART IDENTITY CASCADE`;
    ({
      conversation: { id: cid },
    } = await c.conversations.create(agent1, {
      customerId: CUSTOMER,
      applicationId: 7,
      customerName: "Maya",
      priority: "MEDIUM",
    }));
    await c.assignments.assign(agent1, cid, {});
    c.events.length = 0;
  });

  const send = async (text: string, clientId = text) =>
    (await c.messages.send(agent1, cid, { clientId, text })).message;

  it("edits a message, keeps every earlier version, and updates the preview", async () => {
    const m = await send("first");
    await c.messageActions.edit(agent1, m.id, { text: "second" });
    const edited = await c.messageActions.edit(agent1, m.id, { text: "third" });

    expect(edited).toMatchObject({ content: "third", isEdited: true });
    expect(edited.editedAt).not.toBeNull();
    const history = await c.messageActions.history(agent1, m.id);
    expect(history.edits.map((e) => e.previousContent)).toEqual(["second", "first"]); // newest first
    expect((await db.conversation.findUniqueOrThrow({ where: { id: cid } })).lastMessagePreview).toBe("third");
    expect(c.published("message.updated")).toHaveLength(2);
  });

  it("leaves the preview alone when an older message is edited", async () => {
    const old = await send("old");
    await send("newest");
    await c.messageActions.edit(agent1, old.id, { text: "old, fixed" });
    expect((await db.conversation.findUniqueOrThrow({ where: { id: cid } })).lastMessagePreview).toBe("newest");
  });

  it("refuses edits by anyone but the author, even a supervisor, and hides the message from agents outside the chat", async () => {
    const m = await send("mine");
    await expect(c.messageActions.edit(supervisor, m.id, { text: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(c.messageActions.edit(agent2, m.id, { text: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(c.messageActions.history(agent2, m.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).content).toBe("mine");
  });

  it("soft-deletes: gone from history and unread counts, kept in the table, preview falls back", async () => {
    const a = await send("keep");
    const b = await send("remove me");
    const result = await c.messageActions.remove(agent1, b.id);

    expect(result.deletedBy).toBe(uid(1));
    const row = await db.message.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBe(uid(1));
    const page = await c.messages.history(agent1, cid, { limit: 50 });
    expect(page.items.map((m) => m.id)).toContain(a.id);
    expect(page.items.map((m) => m.id)).not.toContain(b.id);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: cid } })).lastMessagePreview).toBe("keep");
    await expect(c.messageActions.remove(agent1, b.id)).rejects.toBeInstanceOf(NotFoundError); // already gone
  });

  it("lets a supervisor delete a customer message, but an agent cannot", async () => {
    const { message } = await c.messages.receiveFromCustomer({
      customerId: CUSTOMER,
      conversationId: cid,
      clientId: "cu1",
      text: "spam",
    });
    await expect(c.messageActions.remove(agent1, message.id)).rejects.toBeInstanceOf(ForbiddenError);
    await c.messageActions.remove(supervisor, message.id);
    expect((await c.conversations.list(agent1, { filter: "all", page: 1, size: 25 })).items[0]?.unreadCount).toBe(0);
  });

  it("never deletes SYSTEM messages", async () => {
    const system = await db.message.findFirstOrThrow({ where: { conversationId: cid, senderType: "SYSTEM" } });
    await expect(c.messageActions.remove(supervisor, system.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  describe("reactions", () => {
    it("keeps one reaction per user and emoji even for simultaneous requests", async () => {
      const m = await send("hi");
      await Promise.all(Array.from({ length: 5 }, () => c.messageActions.react(agent1, m.id, { emoji: "👍" })));
      await c.messageActions.react(supervisor, m.id, { emoji: "👍" });
      const { reactions } = await c.messageActions.react(agent1, m.id, { emoji: "❤️" });

      expect(reactions.map((r) => [r.userId, r.emoji])).toEqual([
        [uid(1), "👍"],
        [uid(9), "👍"],
        [uid(1), "❤️"],
      ]);
      const history = await c.messages.history(agent1, cid, { limit: 50 });
      expect(history.items.find((i) => i.id === m.id)?.reactions).toHaveLength(3);
    });

    it("removes only one's own reaction", async () => {
      const m = await send("hi");
      const mine = (await c.messageActions.react(agent1, m.id, { emoji: "👍" })).reaction;
      const theirs = (await c.messageActions.react(supervisor, m.id, { emoji: "👍" })).reaction;
      await expect(c.messageActions.unreact(agent1, m.id, theirs.id)).rejects.toBeInstanceOf(ForbiddenError);
      const { reactions } = await c.messageActions.unreact(agent1, m.id, mine.id);
      expect(reactions.map((r) => r.userId)).toEqual([uid(9)]);
    });

    it("cascades with the message and is announced to viewers of the chat", async () => {
      const m = await send("hi");
      c.events.length = 0;
      await c.messageActions.react(agent1, m.id, { emoji: "🙏" });
      expect(c.published("message.reaction_updated")[0]?.payload).toMatchObject({ messageId: m.id });
    });
  });

  describe("replies", () => {
    it("stores the link and is idempotent by clientId", async () => {
      const original = await send("question");
      const first = await c.messageActions.reply(agent1, original.id, { clientId: "r1", text: "answer" });
      const retry = await c.messageActions.reply(agent1, original.id, { clientId: "r1", text: "answer" });
      expect(first.created).toBe(true);
      expect(retry.created).toBe(false);
      expect(first.message.replyToMessageId).toBe(original.id);
      expect(retry.message.id).toBe(first.message.id);
    });
  });

  describe("forwarding", () => {
    let other: string;
    beforeEach(async () => {
      ({
        conversation: { id: other },
      } = await c.conversations.create(agent1, {
        customerId: CUSTOMER,
        applicationId: 8,
        customerName: "Maya",
        priority: "MEDIUM",
      }));
      await c.assignments.assign(agent1, other, {});
    });

    it("copies into another conversation of the same customer and references the original", async () => {
      const m = await send("please forward");
      const { message, created } = await c.messageActions.forward(agent1, m.id, {
        targetConversationId: other,
        clientId: "f1",
      });
      expect(created).toBe(true);
      expect(message).toMatchObject({ conversationId: other, content: "please forward", forwardedFromMessageId: m.id });
      expect((await db.conversation.findUniqueOrThrow({ where: { id: other } })).lastMessagePreview).toBe(
        "please forward",
      );
      expect(c.published("message.forwarded")).toHaveLength(1);

      const retry = await c.messageActions.forward(agent1, m.id, { targetConversationId: other, clientId: "f1" });
      expect(retry.created).toBe(false);
      expect(await db.message.count({ where: { conversationId: other, forwardedFromMessageId: m.id } })).toBe(1);
    });

    it("refuses another customer's conversation and a conversation the caller does not own", async () => {
      const m = await send("private");
      const { conversation: stranger } = await c.conversations.create(agent1, {
        customerId: uid(200),
        applicationId: 9,
        customerName: "Other",
        priority: "MEDIUM",
      });
      await c.assignments.assign(agent1, stranger.id, {});
      await expect(
        c.messageActions.forward(agent1, m.id, { targetConversationId: stranger.id, clientId: "f2" }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await c.assignments.transfer(agent1, other, { agentId: agent2.userId });
      await expect(
        c.messageActions.forward(agent1, m.id, { targetConversationId: other, clientId: "f3" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("survives two simultaneous opposite forwards without deadlocking", async () => {
      const a = await send("from A");
      const b = (await c.messages.send(agent1, other, { clientId: "b1", text: "from B" })).message;
      const results = await Promise.allSettled([
        c.messageActions.forward(agent1, a.id, { targetConversationId: other, clientId: "x1" }),
        c.messageActions.forward(agent1, b.id, { targetConversationId: cid, clientId: "x2" }),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    });

    it("rejects a clientId already used for a different message", async () => {
      const m = await send("one");
      const m2 = await send("two");
      await c.messageActions.forward(agent1, m.id, { targetConversationId: other, clientId: "same" });
      await expect(
        c.messageActions.forward(agent1, m2.id, { targetConversationId: other, clientId: "same" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
