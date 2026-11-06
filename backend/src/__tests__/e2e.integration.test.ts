import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTestDatabase } from "./support/container.js";
import { uid } from "./support/ids.js";
import { TestClient } from "./support/ws-client.js";
import { ForbiddenError } from "@shared/errors/AppError.js";
import type { BusEvent } from "@shared/events/event-bus.js";

/**
 * One working day across all the enhanced-chat features, through the real stack: the Express app over HTTP, the
 * WebSocket gateway over real sockets, the Redis event bus, PostgreSQL. Three people watch: the owning agent, another
 * agent who must not see the conversation, and a supervisor. The point is the seams between features, and above all
 * that nothing sensitive reaches the agent who has no business with the conversation.
 *
 * Needs TEST_DATABASE_URL and TEST_REDIS_URL (a throwaway Redis: it is flushed).
 */
const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const ORIGIN = "http://localhost:5173";
const owner = `dev:${uid(1)}:AGENT`;
const stranger = `dev:${uid(2)}:AGENT`;
const boss = `dev:${uid(9)}:SUPERVISOR`;
const CUSTOMER = uid(101);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500, 7)]);
const MIN = 60_000;

describe.skipIf(!url || !redisUrl)("a working day across every feature (HTTP + WebSocket + Redis + PostgreSQL)", () => {
  let server: Server;
  let base: string;
  let wsUrl: string;
  let db: typeof import("@config/database.js").prisma;
  let services: typeof import("../app-container.js").container;
  const bus: BusEvent[] = [];
  const open: TestClient[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    process.env.REDIS_URL = redisUrl as string;
    process.env.AUTH_MODE = "dev";
    process.env.EVENT_BUS = "redis";
    process.env.STORAGE_DIR = await mkdtemp(join(tmpdir(), "chat-e2e-"));
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    const { app } = await import("../app.js");
    ({ container: services } = await import("../app-container.js"));
    const { attachWebSocketServer } = await import("../websocket/websocket.server.js");
    const { DevAuthClient } = await import("@shared/auth/dev-auth-client.js");
    server = createServer(app);
    attachWebSocketServer(server, services, new DevAuthClient(), { allowedOrigins: [ORIGIN], heartbeatMs: 60_000 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}/api/v1/admin`;
    wsUrl = `ws://127.0.0.1:${port}/ws`;
    services.bus.subscribe((event) => bus.push(event));
  });

  afterAll(async () => {
    for (const client of open.splice(0)) client.close();
    await new Promise((resolve) => server?.close(resolve));
    await services?.bus.close();
    if (db)
      await db.$executeRaw`TRUNCATE customer_blocks, spam_reports, blocked_keywords, moderation_activities, user_chat_settings, canned_responses`;
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags, canned_responses, calls, callback_requests, customer_blocks, spam_reports, blocked_keywords, moderation_activities, user_chat_settings, workspace_preferences, agent_presence_history RESTART IDENTITY CASCADE`;
    await (await import("@config/redis.js")).redis.flushdb();
    bus.length = 0;
  });
  afterEach(async () => {
    for (const client of open.splice(0)) client.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  async function connect(token: string) {
    const client = new TestClient(wsUrl, { Origin: ORIGIN });
    open.push(client);
    await client.ready();
    await client.waitFor("connection.established");
    client.send("auth", { token });
    await client.waitFor("connection.authenticated");
    client.mark();
    return client;
  }
  const api = async (token: string, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, any> };
  };
  const ok = async (token: string, method: string, path: string, body?: unknown, status = 200) => {
    const result = await api(token, method, path, body);
    expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBe(status);
    return result.body.data;
  };

  it("runs the whole story, and the agent with no business there sees none of the sensitive parts", async () => {
    const a1 = await connect(owner);
    const a1Other = await connect(owner); // the same agent's second window
    const a2 = await connect(stranger);
    const sup = await connect(boss);

    // ── a conversation, claimed by agent 1: agent 2 loses sight of it ────────────
    const created = await ok(
      owner,
      "POST",
      "/conversations",
      {
        customerId: CUSTOMER,
        applicationId: uid(7),
        customerName: "Maya Chen",
        priority: "MEDIUM",
      },
      201,
    );
    const cid: string = created.id ?? created.conversation?.id;
    await ok(owner, "POST", `/conversations/${cid}/assign`, {});
    await a2.waitFor("conversation.hidden");
    expect((await api(stranger, "GET", `/conversations/${cid}`)).status).toBe(404);

    // ── the customer writes; the agent answers, edits, reacts ────────────────────
    const hello = await services.messages.receiveFromCustomer({
      customerId: CUSTOMER,
      conversationId: cid,
      clientId: "cust-1",
      text: "Hello, I want to change my repayment date",
    });
    await a1.waitFor("message.new", (p) => p.message.id === hello.message.id);
    const sent = await ok(
      owner,
      "POST",
      `/conversations/${cid}/messages`,
      { clientId: "a-1", text: "Of course, one moment." },
      201,
    );
    const messageId: string = (sent.message ?? sent).id;
    await ok(owner, "PATCH", `/messages/${messageId}`, { text: "Of course, one moment please." });
    await ok(owner, "PUT", `/messages/${messageId}/reactions`, { emoji: "👍" });
    await ok(owner, "POST", `/messages/${messageId}/replies`, { clientId: "a-2", text: "Replying to myself" }, 201);
    await a1.waitFor("message.updated");
    await sup.waitFor("message.updated");

    // ── a file ───────────────────────────────────────────────────────────────────
    const form = new FormData();
    form.set("conversationId", cid);
    form.set("clientId", "file-1");
    form.set("file", new Blob([PNG as unknown as BlobPart], { type: "image/png" }), "statement.png");
    const upload = await fetch(`${base}/attachments/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${owner}` },
      body: form,
    });
    expect(upload.status).toBe(201);
    await a1.waitFor("attachment.uploaded");
    const attachmentId: string = ((await upload.json()) as any).data.attachments[0].id;
    expect(
      (
        await fetch(`${base}/attachments/${attachmentId}/download`, {
          headers: { authorization: `Bearer ${stranger}` },
        })
      ).status,
    ).toBe(404);
    expect(
      (await fetch(`${base}/attachments/${attachmentId}/download`, { headers: { authorization: `Bearer ${owner}` } }))
        .status,
    ).toBe(200);

    // ── organising: note with the text staying out of messages, tag, priority ────
    const noteText = "Customer sounds stressed; offer the hardship plan";
    await ok(owner, "POST", `/conversations/${cid}/notes`, { text: noteText, mentionedAgentIds: [] }, 201);
    const tag = await ok(owner, "POST", "/tags", { name: "Hardship" }, 201);
    await ok(owner, "PUT", `/conversations/${cid}/tags`, { tagIds: [tag.id] });
    await ok(owner, "PATCH", `/conversations/${cid}/priority`, { priority: "HIGH" });
    const history = JSON.stringify(await ok(owner, "GET", `/conversations/${cid}/messages?limit=50`));
    expect(history).not.toContain(noteText);
    await a1.waitFor("note.created");
    await sup.waitFor("conversation.priority_changed");

    // ── an agent's own tools: saved reply, drafts and tabs in a second window, settings ──
    const template = await ok(
      owner,
      "POST",
      "/canned-responses",
      { title: "Greeting", content: "Hello!", shortcut: "/hi" },
      201,
    );
    expect((await api(stranger, "GET", `/canned-responses/${template.id}`)).status).toBe(404);
    await ok(owner, "PUT", `/workspace/tabs/${cid}`);
    await ok(owner, "PUT", `/workspace/drafts/${cid}`, { content: "Dear Maya," });
    await a1Other.waitFor("workspace.draft_updated", (p) => p.content === "Dear Maya,");
    await ok(owner, "PATCH", "/agents/me/chat-settings", { typingSoundEnabled: false });
    await a1Other.waitFor("chat_settings.updated");

    // ── a callback, and its reminder reaches only the assignee ───────────────────
    const when = new Date(Date.now() + 60 * MIN);
    const callback = await ok(
      owner,
      "POST",
      `/conversations/${cid}/callbacks`,
      { scheduledAt: when.toISOString(), notes: "after 5pm" },
      201,
    );
    await sup.waitFor("callback.created");
    await services.callbacks.processDue(new Date(when.getTime() - 5 * MIN));
    await a1.waitFor("callback.reminder");
    await ok(owner, "POST", `/callbacks/${callback.id}/complete`, { completionNote: "reached" });

    // ── escalation and a supervisor's answer ─────────────────────────────────────
    const escalation = await ok(owner, "POST", `/conversations/${cid}/escalations`, { reason: "wants a manager" }, 201);
    await sup.waitFor("conversation.escalated", (p) => p.escalation.status === "PENDING");
    await ok(boss, "PATCH", `/escalations/${escalation.id}`, { status: "RESOLVED" });

    // ── a call with the customer (played through the service: no customer channel yet) ──
    const call = await ok(owner, "POST", `/conversations/${cid}/calls`, { callType: "AUDIO" }, 201);
    await services.calls.acceptByCustomer(CUSTOMER, call.id);
    await a1.waitFor("call.accepted");
    await sup.waitFor("call.accepted");
    a1.send("call.offer", { callId: call.id, sdp: "v=0\r\no=offer" });
    await vi.waitFor(() => expect(bus.some((e) => e.type === "call.offer")).toBe(true));
    await services.calls.relay({ type: "CUSTOMER", id: CUSTOMER }, "answer", {
      callId: call.id,
      sdp: "v=0\r\no=answer",
    });
    expect((await a1.waitFor("call.answer")).sdp).toBe("v=0\r\no=answer");
    await ok(owner, "POST", `/calls/${call.id}/end`);
    await a1.waitFor("call.ended");

    // ── spam: reported, confirmed with a block, then enforced at the customer's door ──
    await ok(
      owner,
      "POST",
      `/conversations/${cid}/spam-reports`,
      { reason: "phishing links", messageId: hello.message.id },
      201,
    );
    await sup.waitFor("spam.reported");
    const queue = await ok(boss, "GET", "/moderation/spam-reports?status=PENDING");
    expect(queue).toHaveLength(1);
    await ok(boss, "PATCH", `/moderation/spam-reports/${queue[0].id}`, { status: "CONFIRMED", blockCustomer: true });
    await a1.waitFor("customer.blocked");
    await expect(
      services.messages.receiveFromCustomer({
        customerId: CUSTOMER,
        conversationId: cid,
        clientId: "cust-2",
        text: "let me in",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await ok(
      owner,
      "POST",
      `/conversations/${cid}/messages`,
      { clientId: "a-3", text: "Your account is paused." },
      201,
    ); // agents still can

    // ── what each person saw ─────────────────────────────────────────────────────
    const seen = (client: TestClient) => new Set(client.frames.map((f) => f.type));
    const sensitive = [
      "message.updated",
      "message.reaction_updated",
      "attachment.uploaded",
      "note.created",
      "conversation.tags_updated",
      "conversation.priority_changed",
      "workspace.tab_opened",
      "workspace.draft_updated",
      "chat_settings.updated",
      "callback.created",
      "callback.reminder",
      "callback.completed",
      "conversation.escalated",
      "call.accepted",
      "call.answer",
      "call.ended",
      "spam.reported",
      "spam.reviewed",
      "customer.blocked",
      "message.new",
    ];
    expect(
      [...seen(a2)].filter((type) => sensitive.includes(type)),
      "what the other agent received",
    ).toEqual([]);
    expect(JSON.stringify(a2.frames)).not.toContain(noteText);
    expect(JSON.stringify(a2.frames)).not.toContain("phishing");

    for (const type of [
      "note.created",
      "callback.created",
      "conversation.escalated",
      "call.accepted",
      "spam.reported",
      "customer.blocked",
      "message.updated",
    ]) {
      expect(seen(sup), `supervisor should receive ${type}`).toContain(type);
    }
    // agent-only events stayed with the agent's own windows
    for (const type of ["callback.reminder", "call.answer", "workspace.draft_updated", "chat_settings.updated"]) {
      expect(seen(sup), `supervisor must not receive ${type}`).not.toContain(type);
    }
    expect(seen(a1Other)).toContain("chat_settings.updated");

    // ── the conversation's timeline and the database after the day ───────────────
    const timeline = await ok(owner, "GET", `/conversations/${cid}/activities?size=100`);
    const types = new Set((timeline as { activityType: string }[]).map((a) => a.activityType));
    for (const type of [
      "ASSIGNED",
      "TAG_ADDED",
      "PRIORITY_CHANGED",
      "NOTE_ADDED",
      "CALLBACK",
      "ESCALATED",
      "CALL",
      "MODERATION",
    ]) {
      expect(types, `timeline should hold ${type}`).toContain(type);
    }

    const [row] = await db.$queryRaw<{ last: bigint; count: bigint; gaps: bigint }[]>`
      SELECT c.last_sequence_number AS last,
             (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS count,
             (SELECT count(*) FROM (SELECT sequence_number, row_number() OVER (ORDER BY sequence_number) AS n
                                      FROM messages WHERE conversation_id = c.id) s WHERE s.sequence_number <> s.n) AS gaps
        FROM conversations c WHERE c.id = ${cid}::uuid`;
    expect(row?.last).toBe(row?.count);
    expect(row?.gaps).toBe(0n);
    const open = await db.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM calls WHERE status IN ('INITIATING','RINGING','ACTIVE')`;
    expect(open[0]?.n).toBe(0n);
    expect(await db.callbackRequest.count({ where: { status: "PENDING" } })).toBe(0);
    expect(await db.customerBlock.count({ where: { unblockedAt: null } })).toBe(1);
  });
});
