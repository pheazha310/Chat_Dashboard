import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase, createTestContainer } from "../../../__tests__/support/container.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, NotFoundError } from "@shared/errors/AppError.js";
import { uid } from "../../../__tests__/support/ids.js";

/** Real repository and services on PostgreSQL. Needs TEST_DATABASE_URL (see conversation-flow.integration.test.ts). */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const agent1: AuthContext = { userId: uid(1), role: "AGENT" };
const agent2: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };

describe.skipIf(!url)("workspace on PostgreSQL", () => {
  let db: typeof import("@config/database.js").prisma;
  let c: Awaited<ReturnType<typeof createTestContainer>>;
  let ids: string[];

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    c = await createTestContainer();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  const make = async (n: number) =>
    (
      await c.conversations.create(agent1, {
        customerId: uid(100 + n),
        applicationId: 200 + n,
        customerName: `Customer ${n}`,
        priority: "MEDIUM",
      })
    ).conversation.id;

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags, workspace_preferences RESTART IDENTITY CASCADE`;
    ids = [await make(1), await make(2), await make(3)];
    c.events.length = 0;
  });

  it("opens each tab once, even when two windows open it at the same moment", async () => {
    await Promise.all([c.workspace.openTab(agent1, ids[0]!), c.workspace.openTab(agent1, ids[0]!)]);
    await c.workspace.openTab(agent1, ids[1]!);
    expect(await db.workspaceOpenConversation.count({ where: { agentId: uid(1) } })).toBe(2);
    expect((await c.workspace.get(agent1)).tabs.map((t) => t.conversationId)).toEqual([ids[0], ids[1]]);
  });

  it("keeps tab order and gives separate agents separate tabs", async () => {
    await c.workspace.openTab(agent1, ids[2]!);
    await c.workspace.openTab(agent1, ids[0]!);
    await c.workspace.openTab(agent2, ids[1]!);
    expect((await c.workspace.get(agent1)).tabs.map((t) => t.conversationId)).toEqual([ids[2], ids[0]]);
    expect((await c.workspace.get(agent2)).tabs.map((t) => t.conversationId)).toEqual([ids[1]]);
  });

  it("closing a tab leaves the conversation untouched", async () => {
    await c.assignments.assign(agent1, ids[0]!, {});
    const before = await db.conversation.findUniqueOrThrow({ where: { id: ids[0]! } });
    await c.workspace.openTab(agent1, ids[0]!);
    c.events.length = 0;
    await c.workspace.closeTab(agent1, ids[0]!);
    const after = await db.conversation.findUniqueOrThrow({ where: { id: ids[0]! } });

    expect(after).toEqual(before);
    expect((await c.workspace.get(agent1)).tabs).toEqual([]);
    expect(c.events.map((e) => e.type)).toEqual(["workspace.tab_closed"]);
    expect(c.events[0]?.audience).toEqual({ kind: "users", userIds: [uid(1)] });
  });

  it("restores tabs with the agent's own unread counts and omits conversations that became hidden", async () => {
    await c.assignments.assign(agent1, ids[0]!, {});
    await c.workspace.openTab(agent1, ids[0]!);
    await c.workspace.openTab(agent1, ids[1]!);
    await c.messages.receiveFromCustomer({ customerId: uid(101), conversationId: ids[0]!, clientId: "u1", text: "hi" });
    await c.messages.receiveFromCustomer({
      customerId: uid(101),
      conversationId: ids[0]!,
      clientId: "u2",
      text: "hello?",
    });

    const tabs = (await c.workspace.get(agent1)).tabs;
    expect(tabs.map((t) => [t.conversationId, t.conversation.unreadCount])).toEqual([
      [ids[0], 2],
      [ids[1], 0],
    ]);

    await c.assignments.transfer(agent1, ids[0]!, { agentId: agent2.userId }); // now only agent 2 (and supervisors) see it
    expect((await c.workspace.get(agent1)).tabs.map((t) => t.conversationId)).toEqual([ids[1]]);
    expect((await c.workspace.get(supervisor)).tabs).toEqual([]); // supervisors see their own tabs only
    await expect(c.workspace.openTab(agent1, ids[0]!)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("limits the number of tabs but still allows refreshing an open one", async () => {
    const many = await Promise.all(Array.from({ length: 21 }, (_, i) => make(10 + i)));
    for (const id of many.slice(0, 20)) await c.workspace.openTab(agent1, id);
    await expect(c.workspace.openTab(agent1, many[20]!)).rejects.toBeInstanceOf(ConflictError);
    await expect(c.workspace.openTab(agent1, many[0]!)).resolves.toMatchObject({ persisted: true });
  });

  it("honours the preferences and merges concurrent updates", async () => {
    await Promise.all([
      c.workspace.updatePreferences(agent1, { restoreTabs: false }),
      c.workspace.updatePreferences(agent1, { persistTabs: false }),
    ]);
    expect((await c.workspace.get(agent1)).preferences).toEqual({ restoreTabs: false, persistTabs: false });

    await expect(c.workspace.openTab(agent1, ids[0]!)).resolves.toMatchObject({ persisted: false });
    expect(await db.workspaceOpenConversation.count()).toBe(0);

    await c.workspace.updatePreferences(agent1, { persistTabs: true });
    await c.workspace.openTab(agent1, ids[0]!);
    expect((await c.workspace.get(agent1)).tabs).toEqual([]); // restoring is still off
    await c.workspace.updatePreferences(agent1, { restoreTabs: true });
    expect((await c.workspace.get(agent1)).tabs).toHaveLength(1);
  });

  it("keeps a separate draft for each agent and conversation", async () => {
    await c.workspace.saveDraft(agent1, ids[0]!, { content: "A for 1" });
    await c.workspace.saveDraft(agent1, ids[1]!, { content: "A for 2" });
    await c.workspace.saveDraft(supervisor, ids[0]!, { content: "S for 1" });
    await c.workspace.saveDraft(agent1, ids[0]!, { content: "A for 1, v2" });

    expect((await c.workspace.get(agent1)).drafts.map((d) => [d.conversationId, d.content]).sort()).toEqual(
      [
        [ids[0], "A for 1, v2"],
        [ids[1], "A for 2"],
      ].sort(),
    );
    expect((await c.workspace.get(supervisor)).drafts.map((d) => d.content)).toEqual(["S for 1"]);
    expect(await db.conversationDraft.count()).toBe(3);
  });

  it("deletes a draft when emptied, and drafts disappear with the conversation", async () => {
    await c.workspace.saveDraft(agent1, ids[0]!, { content: "text" });
    await expect(c.workspace.saveDraft(agent1, ids[0]!, { content: "" })).resolves.toBeNull();
    expect(await db.conversationDraft.count()).toBe(0);

    await c.workspace.saveDraft(agent1, ids[1]!, { content: "text" });
    await db.conversation.delete({ where: { id: ids[1]! } });
    expect(await db.conversationDraft.count()).toBe(0);
  });

  it("enforces the draft length limit in the database too", async () => {
    await expect(
      db.conversationDraft.create({ data: { agentId: uid(1), conversationId: ids[0]!, content: "x".repeat(10_001) } }),
    ).rejects.toThrow();
    await expect(
      db.conversationDraft.create({ data: { agentId: uid(1), conversationId: ids[0]!, content: "" } }),
    ).rejects.toThrow();
  });

  it("refuses a draft for a conversation the agent cannot see", async () => {
    await c.assignments.assign(agent1, ids[0]!, {});
    await expect(c.workspace.saveDraft(agent2, ids[0]!, { content: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
