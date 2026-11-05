import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContainer } from "../../__tests__/support/container.js";
import { TestClient } from "../../__tests__/support/ws-client.js";
import { uid } from "../../__tests__/support/ids.js";

/**
 * Real `ws` clients against the real gateway, services, PostgreSQL and event bus.
 * Needs TEST_DATABASE_URL and a Redis (TEST_REDIS_URL, used for presence). Both are flushed/truncated.
 */
const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const ORIGIN = "http://localhost:5173";

describe.skipIf(!url || !redisUrl)("WebSocket gateway", () => {
  let server: Server;
  let wsUrl: string;
  let db: typeof import("@config/database.js").prisma;
  let c: Awaited<ReturnType<typeof createTestContainer>>;
  let cid: string;
  const open: TestClient[] = [];

  beforeAll(async () => {
    c = await createTestContainer(); // also verifies we are connected to a *test* database
    db = c.db;
    const { attachWebSocketServer } = await import("../websocket.server.js");
    const { DevAuthClient } = await import("@shared/auth/dev-auth-client.js");
    const { createServer } = await import("node:http");
    server = createServer();
    attachWebSocketServer(server, c, new DevAuthClient(), {
      allowedOrigins: [ORIGIN],
      authTimeoutMs: 400,
      typingTtlMs: 300,
      heartbeatMs: 60_000,
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await c?.bus.close();
    await c?.redis.quit().catch(() => undefined);
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags, agent_presence_history RESTART IDENTITY CASCADE`;
    await c.redis.flushdb();
    c.events.length = 0;
    const { conversation } = await c.conversations.create(
      { userId: uid(1), role: "AGENT" },
      { customerId: uid(100), applicationId: uid(7), customerName: "Maya Chen", priority: "MEDIUM" },
    );
    cid = conversation.id;
  });

  afterEach(async () => {
    for (const client of open.splice(0)) client.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  /** Connects and authenticates as `dev:<userId>:<ROLE>`. */
  async function connect(userId: number, role = "AGENT", reconnect = false) {
    const client = new TestClient(wsUrl, { Origin: ORIGIN });
    open.push(client);
    await client.ready();
    await client.waitFor("connection.established");
    client.send("auth", { token: `dev:${uid(userId)}:${role}`, ...(reconnect ? { reconnect } : {}) });
    await client.waitFor(reconnect ? "connection.reconnected" : "connection.authenticated");
    client.mark();
    return client;
  }
  const takeOver = (agent = uid(1)) => c.assignments.assign({ userId: agent, role: "AGENT" }, cid, {});
  const customerSays = (n: number) =>
    c.messages.receiveFromCustomer({
      customerId: uid(100),
      conversationId: cid,
      clientId: `cust-${n}`,
      text: `hello ${n}`,
    });

  describe("connecting and authenticating", () => {
    it("announces the connection and authenticates with a valid token", async () => {
      const client = new TestClient(wsUrl, { Origin: ORIGIN });
      open.push(client);
      await client.ready();
      expect(await client.waitFor("connection.established")).toMatchObject({ authTimeoutMs: 400 });
      client.send("auth", { token: `dev:${uid(7)}:SUPERVISOR` });
      expect(await client.waitFor("connection.authenticated")).toMatchObject({ userId: uid(7), role: "SUPERVISOR" });
    });

    it("sends connection.reconnected when the client says it is reconnecting", async () => {
      const client = await connect(1, "AGENT", true);
      expect(client.closed).toBeNull();
    });

    it("closes sockets that do not authenticate in time", async () => {
      const client = new TestClient(wsUrl);
      open.push(client);
      await client.ready();
      expect((await client.waitClosed()).code).toBe(4401);
    });

    it("rejects any event before auth, bad tokens, and customer tokens", async () => {
      const early = new TestClient(wsUrl);
      open.push(early);
      await early.ready();
      early.send("message.send", { conversationId: uid(1), clientId: "x", text: "hi" });
      expect(await early.waitFor("error")).toMatchObject({ code: "UNAUTHORIZED" });
      expect((await early.waitClosed()).code).toBe(4401);

      const bad = new TestClient(wsUrl);
      open.push(bad);
      await bad.ready();
      bad.send("auth", { token: "nonsense" });
      expect(await bad.waitFor("error")).toMatchObject({ code: "UNAUTHORIZED", event: "auth" });
      expect((await bad.waitClosed()).code).toBe(4401);

      const customer = new TestClient(wsUrl);
      open.push(customer);
      await customer.ready();
      customer.send("auth", { token: `dev:${uid(5)}:CUSTOMER` });
      expect(await customer.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
      expect((await customer.waitClosed()).code).toBe(4403);
    });

    it("refuses browser origins that are not allowed", async () => {
      const client = new TestClient(wsUrl, { Origin: "http://evil.example" });
      await expect(client.ready()).rejects.toThrow(/401|403/);
    });

    it("survives malformed frames, unknown events and a second auth, but not oversized frames", async () => {
      const client = await connect(1);
      client.sendRaw("not json");
      expect(await client.waitFor("error", (p) => p.code === "BAD_REQUEST")).toBeDefined();
      client.send("does.not.exist", {});
      expect(await client.waitFor("error", (p) => p.code === "UNKNOWN_EVENT")).toBeDefined();
      client.send("auth", { token: `dev:${uid(1)}:AGENT` });
      expect(await client.waitFor("error", (p) => p.code === "CONFLICT")).toBeDefined();
      client.send("typing.start", { conversationId: "abc" });
      expect(
        await client.waitFor("error", (p) => p.event === "typing.start" && p.code === "BAD_REQUEST"),
      ).toBeDefined();
      expect(client.closed).toBeNull();

      client.sendRaw("x".repeat(70 * 1024));
      expect((await client.waitClosed()).code).toBe(1009);
    });
  });

  describe("sending messages", () => {
    it("acks the sender's socket, shows other sessions message.new, and tells nobody who cannot see the chat", async () => {
      await takeOver();
      const tabA = await connect(1);
      const tabB = await connect(1);
      const stranger = await connect(2);
      const supervisor = await connect(9, "SUPERVISOR");

      tabA.send("message.send", { conversationId: String(cid), clientId: "c-1", text: "Hello Maya" });
      const ack = await tabA.waitFor("message.ack");
      expect(ack).toMatchObject({ clientId: "c-1", created: true });
      expect(ack.message).toMatchObject({ content: "Hello Maya", senderType: "AGENT", status: "SENT" });

      const fanned = await tabB.waitFor("message.new");
      expect(fanned.message.id).toBe(ack.message.id);
      expect((await supervisor.waitFor("message.new")).message.id).toBe(ack.message.id);
      expect((await tabB.waitFor("conversation.updated")).conversation.lastMessagePreview).toBe("Hello Maya");

      await tabA.expectNone("message.new"); // it got the ack instead
      await stranger.expectNone("message.new");
      await stranger.expectNone("conversation.updated");
      expect(await db.message.count({ where: { clientId: "c-1" } })).toBe(1);
    });

    it("does not duplicate on a retry: the sender is acked again and nobody gets a second message.new", async () => {
      await takeOver();
      const tabA = await connect(1);
      const tabB = await connect(1);
      const send = () => tabA.send("message.send", { conversationId: String(cid), clientId: "c-1", text: "once" });
      send();
      await tabA.waitFor("message.ack");
      send();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const acks = tabA.all("message.ack");
      expect(acks).toHaveLength(2);
      expect(acks[1]).toMatchObject({ created: false });
      expect(acks[1]?.message.id).toBe(acks[0]?.message.id);
      expect(tabB.all("message.new")).toHaveLength(1);
      expect(await db.message.count({ where: { clientId: "c-1" } })).toBe(1);
    });

    it("reports failures with message.failed naming the clientId, for non-owners, strangers and bad input", async () => {
      await takeOver();
      const stranger = await connect(2);
      stranger.send("message.send", { conversationId: String(cid), clientId: "s-1", text: "hi" });
      expect(await stranger.waitFor("message.failed")).toMatchObject({ clientId: "s-1", code: "NOT_FOUND" });

      const owner = await connect(1);
      owner.send("message.send", { conversationId: String(cid), clientId: "e-1", text: "   " });
      expect(await owner.waitFor("message.failed", (p) => p.clientId === "e-1")).toMatchObject({ code: "BAD_REQUEST" });
      owner.send("message.send", { conversationId: uid(999), clientId: "n-1", text: "hi" });
      expect(await owner.waitFor("message.failed", (p) => p.clientId === "n-1")).toMatchObject({ code: "NOT_FOUND" });
      expect(await db.message.count({ where: { senderType: "AGENT" } })).toBe(0);
    });

    it("stops delivering after the conversation moves to someone else", async () => {
      await takeOver();
      const previous = await connect(1);
      const next = await connect(2);
      await c.assignments.transfer({ userId: uid(1), role: "AGENT" }, cid, { agentId: uid(2) });
      expect((await previous.waitFor("conversation.transferred")).agentId).toBe(uid(2)); // told it moved away
      expect((await next.waitFor("conversation.transferred")).conversation.assignedAgentId).toBe(uid(2));
      previous.mark();
      await customerSays(1);
      await next.waitFor("message.new");
      await previous.expectNone("message.new");
    });
  });

  describe("conversation events", () => {
    it("tells agents who lose access with conversation.hidden, and only the owner and supervisors about the assignment", async () => {
      const agent1 = await connect(1);
      const agent2 = await connect(2);
      const supervisor = await connect(9, "SUPERVISOR");

      agent1.send("conversation.takeover", { conversationId: String(cid) });
      expect(await agent1.waitFor("conversation.assigned")).toMatchObject({ agentId: uid(1), action: "TAKEOVER" });
      expect((await supervisor.waitFor("conversation.assigned")).conversation.handoffStatus).toBe("ASSIGNED");
      expect(await agent2.waitFor("conversation.hidden")).toEqual({ conversationId: String(cid) });
      await agent2.expectNone("conversation.assigned");
    });

    it("applies the same permissions as REST to assign, transfer, release and status changes", async () => {
      await takeOver();
      const owner = await connect(1);
      const other = await connect(2);
      const supervisor = await connect(9, "SUPERVISOR");

      other.send("conversation.set_status", { conversationId: String(cid), status: "RESOLVED" });
      expect(await other.waitFor("error", (p) => p.event === "conversation.set_status")).toMatchObject({
        code: "NOT_FOUND",
      });
      owner.send("conversation.assign", { conversationId: String(cid), agentId: uid(2) });
      expect(await owner.waitFor("error", (p) => p.event === "conversation.assign")).toMatchObject({
        code: "FORBIDDEN",
      });
      owner.send("conversation.transfer", { conversationId: String(cid), agentId: uid(1) });
      expect(await owner.waitFor("error", (p) => p.event === "conversation.transfer")).toMatchObject({
        code: "CONFLICT",
      });

      supervisor.send("conversation.assign", { conversationId: String(cid), agentId: uid(2) });
      expect(await other.waitFor("conversation.transferred")).toMatchObject({ agentId: uid(2), assignedBy: uid(9) });

      other.send("conversation.set_status", { conversationId: String(cid), status: "RESOLVED" });
      const changed = await other.waitFor("conversation.status_changed");
      expect(changed).toMatchObject({ from: "OPEN", to: "RESOLVED", actorId: uid(2) });
      expect(changed.conversation.status).toBe("RESOLVED");

      other.send("conversation.set_status", { conversationId: String(cid), status: "OPEN" });
      await other.waitFor("conversation.status_changed", (p) => p.to === "OPEN");
      other.send("conversation.takeover", { conversationId: String(cid) });
      other.send("conversation.release", { conversationId: String(cid) });
      const released = await owner.waitFor("conversation.updated", (p) => p.event === "unassigned");
      expect(released.conversation.handoffStatus).toBe("NEEDS_HUMAN");
    });

    it("announces new conversations to the agents who can see them", async () => {
      const agent2 = await connect(2);
      await c.conversations.create(
        { userId: uid(1), role: "AGENT" },
        { customerId: uid(200), applicationId: uid(8), priority: "HIGH" },
      );
      expect((await agent2.waitFor("conversation.created")).conversation).toMatchObject({
        customerId: uid(200),
        priority: "HIGH",
      });
    });

    it("pushes notification.new only to the agent it is for", async () => {
      const target = await connect(3);
      const bystander = await connect(2);
      await c.assignments.assign({ userId: uid(9), role: "SUPERVISOR" }, cid, { agentId: uid(3) });
      const note = await target.waitFor("notification.new");
      expect(note.notification).toMatchObject({ type: "ASSIGNED", read: false, conversationId: String(cid) });
      await bystander.expectNone("notification.new");
    });
  });

  describe("read state", () => {
    it("syncs unread counts to the agent's other sessions and marks messages READ for viewers", async () => {
      await takeOver();
      await customerSays(1);
      await customerSays(2);
      const tabA = await connect(1);
      const tabB = await connect(1);
      const supervisor = await connect(9, "SUPERVISOR");
      const stranger = await connect(2);

      tabA.send("conversation.read", { conversationId: String(cid) });
      expect(await tabB.waitFor("conversation.read")).toMatchObject({
        conversationId: String(cid),
        unreadCount: 0,
        markedUnread: false,
      });
      await tabA.waitFor("conversation.read");
      const status = await supervisor.waitFor("message.status");
      expect(status).toMatchObject({ conversationId: String(cid), status: "READ" });
      expect(status.messageIds).toHaveLength(2);
      await stranger.expectNone("conversation.read");
      await stranger.expectNone("message.status");

      tabB.send("conversation.unread", { conversationId: String(cid) });
      expect(await tabA.waitFor("conversation.read", (p) => p.markedUnread === true)).toMatchObject({ unreadCount: 1 });
    });

    it("records delivery receipts sent by the client", async () => {
      await takeOver();
      const { message } = await customerSays(1);
      const owner = await connect(1);
      owner.send("message.delivered", { conversationId: String(cid), messageId: message.id });
      expect(await owner.waitFor("message.status")).toMatchObject({ status: "DELIVERED", messageIds: [message.id] });
      expect(await db.messageReceipt.count({ where: { recipientId: uid(1) } })).toBe(1);
    });
  });

  describe("typing", () => {
    it("shows typing to others who can see the chat, never to the typist, and ends it on stop", async () => {
      await takeOver();
      const typist = await connect(1);
      const otherTab = await connect(1);
      const supervisor = await connect(9, "SUPERVISOR");
      const stranger = await connect(2);

      typist.send("typing.start", { conversationId: String(cid) });
      expect(await otherTab.waitFor("typing")).toMatchObject({
        conversationId: String(cid),
        userId: uid(1),
        side: "agent",
        active: true,
      });
      await supervisor.waitFor("typing");
      typist.send("typing.start", { conversationId: String(cid) }); // repeated keystrokes do not re-announce
      typist.send("typing.stop", { conversationId: String(cid) });
      expect(await otherTab.waitFor("typing", (p) => p.active === false)).toBeDefined();
      expect(otherTab.all("typing")).toHaveLength(2);
      await typist.expectNone("typing");
      await stranger.expectNone("typing");
    });

    it("expires by itself when the client goes quiet, and when the socket drops", async () => {
      await takeOver();
      const typist = await connect(1);
      const watcher = await connect(9, "SUPERVISOR");
      typist.send("typing.start", { conversationId: String(cid) });
      await watcher.waitFor("typing", (p) => p.active === true);
      expect(await watcher.waitFor("typing", (p) => p.active === false, 1500)).toBeDefined(); // ttl 300 ms

      watcher.mark();
      typist.send("typing.start", { conversationId: String(cid) });
      await watcher.waitFor("typing", (p) => p.active === true);
      typist.close();
      expect(await watcher.waitFor("typing", (p) => p.active === false, 1500)).toBeDefined();
    });

    it("only the agent who can send may type", async () => {
      await takeOver();
      const other = await connect(2);
      other.send("typing.start", { conversationId: String(cid) });
      expect(await other.waitFor("error", (p) => p.event === "typing.start")).toMatchObject({ code: "NOT_FOUND" });
      const supervisor = await connect(9, "SUPERVISOR");
      supervisor.send("typing.start", { conversationId: String(cid) });
      expect(await supervisor.waitFor("error", (p) => p.event === "typing.start")).toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("presence", () => {
    it("announces online, status changes and offline, and keeps a status history", async () => {
      const watcher = await connect(2);
      const first = await connect(1);
      expect(await watcher.waitFor("presence.updated", (p) => p.userId === uid(1))).toEqual({
        userId: uid(1),
        status: "AVAILABLE",
      });

      first.send("presence.set", { status: "BUSY" });
      expect(await watcher.waitFor("presence.updated", (p) => p.status === "BUSY")).toEqual({
        userId: uid(1),
        status: "BUSY",
      });

      const second = await connect(1); // second tab: still online, nothing new announced
      watcher.mark();
      second.close();
      await watcher.expectNone("presence.updated", 300);

      first.close();
      expect(await watcher.waitFor("presence.updated", (p) => p.status === "OFFLINE")).toEqual({
        userId: uid(1),
        status: "OFFLINE",
      });

      const history = await db.agentPresenceHistory.findMany({
        where: { agentId: uid(1) },
        orderBy: { startedAt: "asc" },
      });
      expect(history.map((h) => h.status)).toEqual(["AVAILABLE", "BUSY", "OFFLINE"]);
      expect(history.filter((h) => h.endedAt === null)).toHaveLength(1); // exactly one open period
    });

    it("remembers the chosen status across reconnects, rejects OFFLINE, and lists who is online", async () => {
      const agent = await connect(1);
      agent.send("presence.set", { status: "AWAY" });
      agent.send("presence.set", { status: "OFFLINE" });
      expect(await agent.waitFor("error", (p) => p.event === "presence.set")).toMatchObject({ code: "BAD_REQUEST" });
      expect(await c.presence.snapshot()).toEqual([{ userId: uid(1), status: "AWAY" }]);
      agent.close();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await c.presence.snapshot()).toEqual([]);
      const again = await connect(1);
      expect((await again.waitFor("presence.updated", () => true, 500).catch(() => null)) ?? null).toBeNull(); // own announce is ok
      expect(await c.presence.snapshot()).toEqual([{ userId: uid(1), status: "AWAY" }]);
    });
  });

  describe("reconnect and synchronization", () => {
    it("sync returns the inbox with per-agent unread counts and the selected conversation's latest messages", async () => {
      await takeOver();
      await customerSays(1);
      await c.messages.send({ userId: uid(1), role: "AGENT" }, cid, { clientId: "a-1", text: "reply" });
      const client = await connect(1);
      client.send("sync.request", { selectedConversationId: String(cid) });
      const sync = await client.waitFor("sync");
      expect(sync.conversations).toHaveLength(1);
      expect(sync.conversations[0]).toMatchObject({ id: String(cid), unreadCount: 1, assignedAgentId: uid(1) });
      expect(sync.meta).toMatchObject({ total: 1 });
      expect(sync.messages[String(cid)].map((m: { content: string }) => m.content)).toEqual([
        `Agent ${uid(1)} took over the conversation`,
        "hello 1",
        "reply",
      ]);
      expect(sync.presence).toEqual([{ userId: uid(1), status: "AVAILABLE" }]);
      expect(new Date(sync.serverTime).getTime()).toBeGreaterThan(0);
    });

    it("after a reconnect, the cursor brings back exactly the messages that were missed", async () => {
      await takeOver();
      await customerSays(1);
      const before = await connect(1);
      before.send("sync.request", { selectedConversationId: String(cid) });
      const first = await before.waitFor("sync");
      const lastSeen = first.messages[String(cid)].at(-1).sequenceNumber as string;
      before.close();
      await before.waitClosed();

      await customerSays(2); // missed while offline
      await customerSays(3);

      const after = await connect(1, "AGENT", true);
      after.send("sync.request", { cursors: { [String(cid)]: lastSeen } });
      const sync = await after.waitFor("sync");
      expect(sync.messages[String(cid)].map((m: { content: string }) => m.content)).toEqual(["hello 2", "hello 3"]);
      expect(sync.incomplete).toEqual([]);
      expect(sync.conversations[0].unreadCount).toBe(3);

      after.send("sync.request", { cursors: { [String(cid)]: sync.messages[String(cid)].at(-1).sequenceNumber } });
      const again = await after.waitFor("sync", () => after.all("sync").length >= 2);
      expect(again).toBeDefined();
      expect(after.all("sync")[1]?.messages[String(cid)]).toEqual([]); // nothing new, nothing duplicated
    });

    it("flags conversations with more missed messages than one page, and skips ones the agent cannot see", async () => {
      await takeOver();
      const rows = Array.from({ length: 105 }, (_, n) => ({
        conversationId: cid,
        sequenceNumber: BigInt(n + 10),
        senderType: "CUSTOMER",
        senderId: uid(100),
        content: `bulk ${n}`,
      }));
      await db.message.createMany({ data: rows });
      await db.conversation.update({ where: { id: cid }, data: { lastSequenceNumber: 115n } });

      const owner = await connect(1);
      owner.send("sync.request", { cursors: { [String(cid)]: "5" } });
      const sync = await owner.waitFor("sync");
      expect(sync.messages[String(cid)]).toHaveLength(100);
      expect(sync.incomplete).toEqual([String(cid)]);

      const stranger = await connect(2);
      stranger.send("sync.request", { cursors: { [String(cid)]: "1" }, selectedConversationId: String(cid) });
      const hidden = await stranger.waitFor("sync");
      expect(hidden.conversations).toEqual([]);
      expect(hidden.messages).toEqual({});
    });
  });

  describe("notifications", () => {
    it("notification.read from one tab updates the agent's other sessions with the new count", async () => {
      await c.assignments.assign({ userId: uid(9), role: "SUPERVISOR" }, cid, { agentId: uid(3) });
      const tabA = await connect(3);
      const tabB = await connect(3);
      tabA.send("sync.request", {});
      expect((await tabA.waitFor("sync")).notifications).toEqual({ unreadCount: 1 });

      await c.assignments.transfer({ userId: uid(9), role: "SUPERVISOR" }, cid, { agentId: uid(4) });
      await c.assignments.transfer({ userId: uid(9), role: "SUPERVISOR" }, cid, { agentId: uid(3) });
      const second = await tabA.waitFor("notification.new", (p) => p.notification.type === "TRANSFERRED");
      tabA.send("notification.read", { notificationId: second.notification.id });
      // assigned, transferred away, transferred back: three unread, minus the one just read
      expect(await tabB.waitFor("notification.read")).toEqual({
        notificationId: second.notification.id,
        unreadCount: 2,
      });

      tabB.send("notification.read", {});
      expect(await tabA.waitFor("notification.read", (p) => p.notificationId === null)).toEqual({
        notificationId: null,
        unreadCount: 0,
      });
    });

    it("cannot read someone else's notification over the socket", async () => {
      await c.assignments.assign({ userId: uid(9), role: "SUPERVISOR" }, cid, { agentId: uid(3) });
      const mine = await connect(3);
      mine.send("sync.request", {});
      await mine.waitFor("sync");
      const row = await db.notification.findFirstOrThrow({ where: { recipientId: uid(3) } });
      const intruder = await connect(2);
      intruder.send("notification.read", { notificationId: String(row.id) });
      expect(await intruder.waitFor("error", (p) => p.event === "notification.read")).toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).toBeNull();
    });

    it("tells AVAILABLE agents about a new waiting conversation, but not BUSY ones or its creator", async () => {
      const available = await connect(2);
      const busy = await connect(5);
      busy.send("presence.set", { status: "BUSY" });
      await busy.waitFor("presence.updated", (p) => p.userId === uid(5) && p.status === "BUSY");
      const creator = await connect(1);
      creator.mark();

      await c.conversations.create(
        { userId: uid(1), role: "AGENT" },
        { customerId: uid(200), applicationId: uid(8), customerName: "Sokha", priority: "HIGH" },
      );
      const note = await available.waitFor("notification.new", (p) => p.notification.type === "NEW_CONVERSATION");
      expect(note.notification).toMatchObject({
        title: "New conversation needs attention",
        body: "Sokha is waiting for an agent",
      });
      await busy.expectNone("notification.new");
      await creator.expectNone("notification.new");
    });
  });
});
