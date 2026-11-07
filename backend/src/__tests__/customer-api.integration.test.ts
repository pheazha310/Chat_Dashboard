import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "./support/container.js";
import { uid } from "./support/ids.js";

/** HTTP-level check of the mobile customer API (/api/v1/customer). Needs TEST_DATABASE_URL, like the other integration tests. */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

describe.skipIf(!url)("/api/v1/customer over HTTP", () => {
  let server: Server;
  let host: string;
  let db: typeof import("@config/database.js").prisma;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    process.env.AUTH_MODE = "dev";
    process.env.EVENT_BUS = "memory";
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    const { app } = await import("../app.js");
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags RESTART IDENTITY CASCADE`;
  });

  const maya = `dev:${uid(100)}:CUSTOMER`;
  const noah = `dev:${uid(101)}:CUSTOMER`;
  const agent = `dev:${uid(1)}:AGENT`;

  const call = async (path: string, token: string | null, init: { method?: string; body?: unknown } = {}) => {
    const isForm = init.body instanceof FormData;
    const response = await fetch(`${host}/customer${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(isForm || init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(init.body === undefined ? {} : { body: isForm ? (init.body as FormData) : JSON.stringify(init.body) }),
    });
    const text = await response.text();
    let body: Record<string, any> = {};
    try {
      body = JSON.parse(text) as Record<string, any>;
    } catch {
      /* a file download */
    }
    return { status: response.status, body, text, headers: response.headers };
  };
  const join = async (token = maya, body: unknown = { applicationId: uid(200) }) =>
    call("/conversations/join", token, { method: "POST", body });

  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const form = (fields: Record<string, string>, file: { name: string; type: string; bytes: Uint8Array }) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.append(key, value);
    data.append("file", new Blob([Buffer.from(file.bytes)], { type: file.type }), file.name);
    return data;
  };

  it("accepts only customer tokens", async () => {
    expect((await call("/conversations/join", null, { method: "POST", body: {} })).status).toBe(401);
    expect((await call("/conversations/join", agent, { method: "POST", body: {} })).status).toBe(403);
    // and the dashboard stays closed to customers
    const staff = await fetch(`${host}/admin/conversations`, { headers: { authorization: `Bearer ${maya}` } });
    expect(staff.status).toBe(403);
  });

  it("joins: creates once, then returns the same conversation without agent details", async () => {
    const first = await join();
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ applicationId: uid(200), status: "OPEN", agentAssigned: false });
    expect(first.body.data).not.toHaveProperty("assignedAgentId");
    const again = await join();
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    // another customer cannot join someone else's application
    expect((await join(noah)).status).toBe(404);
  });

  it("sends text idempotently and retrieves it", async () => {
    const id = (await join()).body.data.id as string;
    const send = (clientId: string) =>
      call(`/conversations/${id}/messages`, maya, { method: "POST", body: { clientId, text: "hello" } });
    const first = await send("m1");
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ senderType: "CUSTOMER", type: "TEXT", content: "hello" });
    expect((await send("m1")).status).toBe(200);

    const history = await call(`/conversations/${id}/messages`, maya);
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    const catchUp = await call(`/conversations/${id}/messages?after=1`, maya);
    expect(catchUp.body.data).toHaveLength(0);
    expect((await call(`/conversations/${id}/messages`, noah)).status).toBe(404);
    expect(
      (await call(`/conversations/${id}/messages`, noah, { method: "POST", body: { clientId: "x", text: "hi" } }))
        .status,
    ).toBe(404);
    expect(
      (await call(`/conversations/${id}/messages`, maya, { method: "POST", body: { clientId: "x" } })).status,
    ).toBe(400);
  });

  it("hides internal SYSTEM messages from the customer", async () => {
    const id = (await join()).body.data.id as string;
    await db.$executeRaw`UPDATE conversations SET last_sequence_number = 1, last_message_at = now() WHERE id = ${id}::uuid`;
    await db.$executeRaw`INSERT INTO messages (conversation_id, sequence_number, sender_type, message_type, content, status) VALUES (${id}::uuid, 1, 'SYSTEM', 'SYSTEM', 'Agent took over', 'SENT')`;
    expect((await call(`/conversations/${id}/messages`, maya)).body.data).toHaveLength(0);
  });

  it("uploads a file and a voice message, and downloads them back (own conversation only)", async () => {
    const id = (await join()).body.data.id as string;
    const file = await call(`/conversations/${id}/files`, maya, {
      method: "POST",
      body: form({ clientId: "f1", text: "my ID" }, { name: "id.png", type: "image/png", bytes: PNG }),
    });
    expect(file.status).toBe(201);
    const attachment = file.body.data.attachments[0];
    expect(attachment).toMatchObject({ kind: "IMAGE", uploadedByType: "CUSTOMER", uploadedById: uid(100) });

    const voice = await call(`/conversations/${id}/voice-messages`, maya, {
      method: "POST",
      body: form(
        { clientId: "v1", durationMs: "1200" },
        { name: "voice.webm", type: "audio/webm", bytes: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0]) },
      ),
    });
    expect(voice.status).toBe(201);
    expect(voice.body.data).toMatchObject({ type: "VOICE" });

    const download = await call(attachment.downloadPath, maya);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect((await call(attachment.downloadPath, noah)).status).toBe(404);
    expect((await call(`/messages/${voice.body.data.id}/audio`, maya)).status).toBe(200);
    expect((await call(`/messages/${voice.body.data.id}/audio`, noah)).status).toBe(404);

    // a retry of the same clientId returns the original message
    const retry = await call(`/conversations/${id}/files`, maya, {
      method: "POST",
      body: form({ clientId: "f1" }, { name: "id.png", type: "image/png", bytes: PNG }),
    });
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(file.body.data.id);

    // a disallowed type is rejected
    const bad = await call(`/conversations/${id}/files`, maya, {
      method: "POST",
      body: form({ clientId: "f2" }, { name: "x.html", type: "text/html", bytes: new Uint8Array([60, 104]) }),
    });
    expect(bad.status).toBe(400);
  });

  it("reopens a closed conversation when the customer writes again", async () => {
    const id = (await join()).body.data.id as string;
    await db.$executeRaw`UPDATE conversations SET status = 'RESOLVED', resolved_at = now() WHERE id = ${id}::uuid`;
    await call(`/conversations/${id}/messages`, maya, {
      method: "POST",
      body: { clientId: "r1", text: "one more thing" },
    });
    expect((await call(`/conversations/${id}`, maya)).body.data.status).toBe("OPEN");
  });
});
