import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTestDatabase } from "../../../__tests__/support/container.js";
import { uid } from "../../../__tests__/support/ids.js";

/** The automatic replies and training examples over real HTTP and PostgreSQL. Needs TEST_DATABASE_URL. */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const agent = `dev:${uid(1)}:AGENT`;
const supervisor = `dev:${uid(9)}:SUPERVISOR`;
const maya = `dev:${uid(100)}:CUSTOMER`;
const texts = { firstResponse: "Hi! An agent will be with you shortly.", awayMessage: "We are away right now." };

describe.skipIf(!url)("automatic replies and training examples over HTTP", () => {
  let server: Server;
  let host: string;
  let db: typeof import("@config/database.js").prisma;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    process.env.AUTH_MODE = "dev";
    process.env.EVENT_BUS = "memory";
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    const { app } = await import("../../../app.js");
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterAll(async () => {
    // Rules are not truncated by the other suites; leave none behind or their customers would get automatic replies.
    if (db) await db.$executeRaw`TRUNCATE automation_rules, ai_training_examples CASCADE`;
    await new Promise((resolve) => server?.close(resolve));
    await db?.$disconnect();
  });

  afterEach(() => vi.restoreAllMocks());

  /** Who is online comes from Redis, which is shared with whatever else is running: the tests decide it instead. */
  const agentsAvailable = async (ids: string[]) => {
    const { container } = await import("../../../app-container.js");
    vi.spyOn(container.presence, "availableAgentIds").mockResolvedValue(ids);
  };

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, automation_rules, ai_training_examples, notifications, notification_preferences RESTART IDENTITY CASCADE`;
  });

  const call = async (path: string, token: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${host}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const admin = (path: string, token: string, method?: string, body?: unknown) =>
    call(`/admin/automation${path}`, token, method, body);
  const customerHistory = async (conversationId: string) =>
    (await call(`/customer/conversations/${conversationId}/messages`, maya)).body.data as Record<string, any>[];

  it("returns nulls until saved, and only a supervisor can save", async () => {
    expect((await admin("/auto-responses", agent)).body.data).toEqual({ awayMessage: null, firstResponse: null });
    expect((await admin("/auto-responses", agent, "PUT", texts)).status).toBe(403);
    expect((await admin("/auto-responses", supervisor, "PUT", { ...texts, awayMessage: "  " })).status).toBe(400);

    const saved = await admin("/auto-responses", supervisor, "PUT", texts);
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual(texts);
    // Saving again edits the same two rules instead of adding more.
    await admin("/auto-responses", supervisor, "PUT", { ...texts, awayMessage: "Back tomorrow." });
    expect((await admin("/auto-responses", agent)).body.data.awayMessage).toBe("Back tomorrow.");
    expect(await db.automationRule.count()).toBe(2);
  });

  it("sends the first response to a new conversation, once, as a message the customer can see", async () => {
    await admin("/auto-responses", supervisor, "PUT", texts);
    const joined = await call("/customer/conversations/join", maya, "POST", { applicationId: 200 });
    const conversationId = joined.body.data.id as string;

    const history = await customerHistory(conversationId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ senderType: "ASSISTANT", content: texts.firstResponse, metadata: null });

    // Joining again reuses the open conversation and sends nothing more.
    await call("/customer/conversations/join", maya, "POST", { applicationId: 200 });
    expect(await customerHistory(conversationId)).toHaveLength(1);
    expect(await db.automationLog.count({ where: { conversationId, executionStatus: "SUCCESS" } })).toBe(1);
  });

  it("sends the away message when the customer writes and nobody is available, but only once an hour", async () => {
    await agentsAvailable([]);
    await admin("/auto-responses", supervisor, "PUT", texts);
    const conversationId = (await call("/customer/conversations/join", maya, "POST", {})).body.data.id as string;
    const send = (clientId: string) =>
      call(`/customer/conversations/${conversationId}/messages`, maya, "POST", { clientId, text: "Hello?" });
    expect((await send("c1")).status).toBe(201);
    expect((await send("c2")).status).toBe(201);

    const contents = (await customerHistory(conversationId)).map((message) => message.content);
    expect(contents.filter((content) => content === texts.awayMessage)).toHaveLength(1);
    expect(contents.filter((content) => content === "Hello?")).toHaveLength(2);
  });

  it("does not send the away message while an agent is available", async () => {
    await agentsAvailable([uid(1)]);
    await admin("/auto-responses", supervisor, "PUT", texts);
    const conversationId = (await call("/customer/conversations/join", maya, "POST", {})).body.data.id as string;
    await call(`/customer/conversations/${conversationId}/messages`, maya, "POST", { clientId: "c1", text: "Hello?" });
    const contents = (await customerHistory(conversationId)).map((message) => message.content);
    expect(contents).toEqual([texts.firstResponse, "Hello?"]);
  });

  it("sends nothing before the team has saved a text", async () => {
    const conversationId = (await call("/customer/conversations/join", maya, "POST", {})).body.data.id as string;
    await call(`/customer/conversations/${conversationId}/messages`, maya, "POST", { clientId: "c1", text: "Hi" });
    expect((await customerHistory(conversationId)).map((message) => message.content)).toEqual(["Hi"]);
  });

  it("lets an agent propose a training example, and only a supervisor approve or withdraw approval", async () => {
    const created = await admin("/training-examples", agent, "POST", { customerMessage: "Q?", suggestedReply: "A." });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "PENDING", createdBy: uid(1), approvedBy: null });
    const id = created.body.data.id as string;

    expect((await admin(`/training-examples/${id}`, agent, "PATCH", { approved: true })).status).toBe(403);
    const approved = await admin(`/training-examples/${id}`, supervisor, "PATCH", { approved: true });
    expect(approved.body.data).toMatchObject({ status: "APPROVED", approvedBy: uid(9) });
    expect(approved.body.data.approvedAt).toEqual(expect.any(String));
    expect((await admin("/training-examples", agent)).body.data).toHaveLength(1);

    const withdrawn = await admin(`/training-examples/${id}`, supervisor, "PATCH", { approved: false });
    expect(withdrawn.body.data).toMatchObject({ status: "PENDING", approvedBy: null, approvedAt: null });
    expect((await admin(`/training-examples/${uid(99)}`, supervisor, "PATCH", { approved: true })).status).toBe(404);
  });
});
