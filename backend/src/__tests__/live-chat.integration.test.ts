import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "./support/container.js";
import { TestClient } from "./support/ws-client.js";

/**
 * A customer and an agent chatting in real time, exactly as the mobile app and the dashboard do: real accounts (the
 * customer registers, the agent signs in with a password), real JWTs (AUTH_MODE=jwt), HTTP for the REST API, real
 * sockets on /ws, the Redis event bus and PostgreSQL. Messages go both ways over REST and over the socket, and each
 * side must see the other's message live, see typing, and catch up after a reconnect, while nobody else sees anything.
 *
 * Needs TEST_DATABASE_URL and TEST_REDIS_URL (a throwaway Redis: it is flushed).
 */
const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const ORIGIN = "http://localhost:5173";
const AGENT_PASSWORD = "agent-password-1";

describe.skipIf(!url || !redisUrl)("live chat between a customer and an agent (HTTP + WebSocket + Redis)", () => {
  let server: Server;
  let host: string;
  let wsUrl: string;
  let db: typeof import("@config/database.js").prisma;
  let services: typeof import("../app-container.js").container;
  let users: typeof import("../app-container.js").userService;
  const open: TestClient[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    process.env.REDIS_URL = redisUrl as string;
    process.env.AUTH_MODE = "jwt";
    process.env.JWT_SECRET = "live-chat-test-secret-0123456789abcdef";
    process.env.EVENT_BUS = "redis";
    process.env.BACKEND1_MODE = "local";
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = "1000";
    process.env.STORAGE_DIR = await mkdtemp(join(tmpdir(), "chat-live-"));
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    const { app } = await import("../app.js");
    const container = await import("../app-container.js");
    ({ container: services, userService: users } = container);
    const { attachWebSocketServer } = await import("../websocket/websocket.server.js");
    server = createServer(app);
    // The same authentication the running server uses (server.ts): real access tokens, checked against the account.
    attachWebSocketServer(server, services, container.authClient, { allowedOrigins: [ORIGIN], heartbeatMs: 60_000 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    host = `http://127.0.0.1:${port}/api/v1`;
    wsUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterAll(async () => {
    for (const client of open.splice(0)) client.close();
    await new Promise((resolve) => server?.close(resolve));
    await services?.bus.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, users, refresh_tokens, chat_users, agent_presence_history, customer_blocks RESTART IDENTITY CASCADE`;
    await (await import("@config/redis.js")).redis.flushdb();
  });

  afterEach(async () => {
    for (const client of open.splice(0)) client.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  // ─── helpers ───────────────────────────────────────────────────────────────

  const http = async (method: string, path: string, token: string | null, body?: unknown) => {
    const response = await fetch(`${host}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, any> };
  };
  const ok = async (method: string, path: string, token: string | null, body?: unknown, status = 200) => {
    const result = await http(method, path, token, body);
    expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBe(status);
    return result.body.data;
  };

  /** A mobile customer who registers in the app. */
  const registerCustomer = async (username: string, displayName: string) => {
    const session = await ok(
      "POST",
      "/customer/auth/register",
      null,
      { username, password: "customer-pw-1", displayName },
      201,
    );
    return { token: session.accessToken as string, id: session.user.id as string };
  };

  /** A dashboard agent created by an admin, who signs in with a password. */
  const signInAgent = async (username: string, displayName: string) => {
    await users.bootstrapAccount({ username, displayName, password: AGENT_PASSWORD, role: "AGENT" });
    const session = await ok("POST", "/admin/auth/login", null, { username, password: AGENT_PASSWORD });
    return { token: session.accessToken as string, id: session.user.id as string };
  };

  /** A socket: the dashboard sends an Origin header, the mobile app does not. */
  const connect = async (token: string, origin?: string) => {
    const client = new TestClient(wsUrl, origin ? { Origin: origin } : {});
    open.push(client);
    await client.ready();
    await client.waitFor("connection.established");
    client.send("auth", { token });
    await client.waitFor("connection.authenticated");
    client.mark();
    return client;
  };
  const joinRoom = async (client: TestClient, conversationId: string) => {
    client.send("room.join", { conversationId });
    return client.waitFor("room.joined", (p) => p.conversationId === conversationId);
  };
  const isText = (text: string) => (p: Record<string, any>) => p.message?.content === text;

  /** Customer opens the chat screen, agent opens the dashboard; both sockets are connected. */
  async function setUp() {
    const customer = await registerCustomer("dara", "Dara");
    const agent = await signInAgent("sophea", "Sophea");
    const conversation = await ok("POST", "/customer/conversations/join", customer.token, {}, 201);
    const agentWs = await connect(agent.token, ORIGIN);
    const customerWs = await connect(customer.token);
    await joinRoom(customerWs, conversation.id);
    customerWs.mark();
    return { customer, agent, conversationId: conversation.id as string, agentWs, customerWs };
  }

  // ─── tests ─────────────────────────────────────────────────────────────────

  it("delivers messages both ways in real time, over REST and over the socket", async () => {
    const { customer, agent, conversationId: id, agentWs, customerWs } = await setUp();

    // 1. Customer writes over REST: the agent's dashboard gets it live (the chat waits in the shared queue).
    await ok(
      "POST",
      `/customer/conversations/${id}/messages`,
      customer.token,
      { clientId: "c-1", text: "Hello, I need help with my loan" },
      201,
    );
    const first = await agentWs.waitFor("message.new", isText("Hello, I need help with my loan"));
    expect(first.message).toMatchObject({ conversationId: id, senderType: "CUSTOMER", senderId: customer.id });

    // 2. The agent takes the chat and answers over the socket: acknowledged to the agent, delivered to the customer.
    await ok("POST", `/admin/conversations/${id}/assign`, agent.token, {});
    agentWs.send("message.send", {
      conversationId: id,
      clientId: "a-1",
      text: "Hi Dara, I can help. What is the question?",
    });
    expect(await agentWs.waitFor("message.ack", (p) => p.clientId === "a-1")).toMatchObject({ created: true });
    const reply = await customerWs.waitFor("message.new", isText("Hi Dara, I can help. What is the question?"));
    expect(reply.message).toMatchObject({ senderType: "AGENT", metadata: null });

    // 3. Customer answers over the socket: acknowledged to the app, delivered to the agent.
    customerWs.send("message.send", { conversationId: id, clientId: "c-2", text: "When is my next payment due?" });
    expect(await customerWs.waitFor("message.ack", (p) => p.clientId === "c-2")).toMatchObject({ created: true });
    await agentWs.waitFor("message.new", isText("When is my next payment due?"));

    // 4. Agent answers over REST (the dashboard's send button): delivered to the customer.
    await ok(
      "POST",
      `/admin/conversations/${id}/messages`,
      agent.token,
      { clientId: "a-2", text: "On the 15th." },
      201,
    );
    await customerWs.waitFor("message.new", isText("On the 15th."));

    // 5. A retry with the same clientId is not a second message, and nobody is told twice.
    customerWs.mark();
    agentWs.mark();
    customerWs.send("message.send", { conversationId: id, clientId: "c-2", text: "When is my next payment due?" });
    expect(await customerWs.waitFor("message.ack", (p) => p.clientId === "c-2")).toMatchObject({ created: false });
    await agentWs.expectNone("message.new");

    // 6. Both sides read the same history, in order.
    const expected = [
      ["CUSTOMER", "Hello, I need help with my loan"],
      ["AGENT", "Hi Dara, I can help. What is the question?"],
      ["CUSTOMER", "When is my next payment due?"],
      ["AGENT", "On the 15th."],
    ];
    const customerHistory = (await ok("GET", `/customer/conversations/${id}/messages`, customer.token)) as Record<
      string,
      any
    >[];
    const visible = customerHistory.filter((m) => m.senderType !== "SYSTEM");
    expect(visible.map((m) => [m.senderType, m.content])).toEqual(expected);
    const staffHistory = (await ok("GET", `/admin/conversations/${id}/messages?limit=50`, agent.token)) as Record<
      string,
      any
    >[];
    const chat = staffHistory.filter((m) => m.senderType !== "SYSTEM");
    expect(chat.map((m) => [m.senderType, m.content])).toEqual(expected);
    const numbers = staffHistory.map((m) => Number(m.sequenceNumber));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it("shows each side the other's typing, without revealing the agent's id to the customer", async () => {
    const { agent, conversationId: id, agentWs, customerWs } = await setUp();
    await ok("POST", `/admin/conversations/${id}/assign`, agent.token, {});
    agentWs.mark();
    customerWs.mark();

    customerWs.send("typing.start", { conversationId: id });
    expect(await agentWs.waitFor("typing", (p) => p.side === "customer")).toMatchObject({
      conversationId: id,
      active: true,
    });

    agentWs.send("typing.start", { conversationId: id });
    const typing = await customerWs.waitFor("typing", (p) => p.side === "agent");
    expect(typing).toMatchObject({ conversationId: id, active: true });
    expect(typing).not.toHaveProperty("userId");

    agentWs.send("typing.stop", { conversationId: id });
    await customerWs.waitFor("typing", (p) => p.side === "agent" && p.active === false);
  });

  it("lets the app catch up after a reconnect: room.join gives the last number, REST ?after= the missed messages", async () => {
    const { customer, agent, conversationId: id, customerWs } = await setUp();
    await ok(
      "POST",
      `/customer/conversations/${id}/messages`,
      customer.token,
      { clientId: "c-1", text: "Are you there?" },
      201,
    );
    await ok("POST", `/admin/conversations/${id}/assign`, agent.token, {});
    const before = await ok("GET", `/customer/conversations/${id}/messages`, customer.token);
    const seen = Math.max(...before.map((m: Record<string, any>) => Number(m.sequenceNumber)));

    customerWs.close(); // the phone loses its connection
    await ok(
      "POST",
      `/admin/conversations/${id}/messages`,
      agent.token,
      { clientId: "a-1", text: "Yes, sorry for the wait." },
      201,
    );

    const again = await connect(customer.token);
    const joined = await joinRoom(again, id);
    expect(Number(joined.lastSequenceNumber)).toBeGreaterThan(seen);
    const missed = await ok("GET", `/customer/conversations/${id}/messages?after=${seen}`, customer.token);
    expect(missed.map((m: Record<string, any>) => m.content)).toContain("Yes, sorry for the wait.");

    // And the reconnected socket is live again.
    await ok(
      "POST",
      `/admin/conversations/${id}/messages`,
      agent.token,
      { clientId: "a-2", text: "Back online?" },
      201,
    );
    await again.waitFor("message.new", isText("Back online?"));
  });

  it("keeps the chat private: other customers and agents who do not own it see nothing", async () => {
    const { customer, agent, conversationId: id, agentWs, customerWs } = await setUp();
    const other = await registerCustomer("noah", "Noah");
    const otherWs = await connect(other.token);
    const bystander = await signInAgent("bopha", "Bopha");
    const bystanderWs = await connect(bystander.token, ORIGIN);

    // Another customer cannot join this room, read it or write to it.
    otherWs.send("room.join", { conversationId: id });
    expect(await otherWs.waitFor("room.error")).toMatchObject({ conversationId: id });
    expect((await http("GET", `/customer/conversations/${id}/messages`, other.token)).status).toBe(404);
    otherWs.send("message.send", { conversationId: id, clientId: "x-1", text: "let me in" });
    await otherWs.waitFor("message.failed");

    // Once Sophea owns the chat, another agent no longer receives its messages.
    await ok("POST", `/admin/conversations/${id}/assign`, agent.token, {});
    otherWs.mark();
    bystanderWs.mark();
    await ok(
      "POST",
      `/customer/conversations/${id}/messages`,
      customer.token,
      { clientId: "c-1", text: "my account number is 1234" },
      201,
    );
    await agentWs.waitFor("message.new", isText("my account number is 1234"));
    await otherWs.expectNone("message.new");
    await bystanderWs.expectNone("message.new");
    expect((await http("GET", `/admin/conversations/${id}/messages`, bystander.token)).status).toBe(404);

    // Customers may not use staff events, and staff tokens do not work on the customer API.
    customerWs.send("sync.request", {});
    expect(await customerWs.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
    expect((await http("POST", "/customer/conversations/join", agent.token, {})).status).toBe(403);
    expect((await http("GET", "/admin/conversations", customer.token)).status).toBe(403);
  });

  it("refuses sockets without a valid token", async () => {
    const client = new TestClient(wsUrl);
    open.push(client);
    await client.ready();
    await client.waitFor("connection.established");
    client.send("auth", { token: "not-a-real-token" });
    await client.waitClosed();
  });
});
