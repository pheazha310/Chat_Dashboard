import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "../../../__tests__/support/container.js";
import { uid } from "../../../__tests__/support/ids.js";

/** Files over real HTTP: multipart upload, secured download with ranges, voice, listing, delete. Needs TEST_DATABASE_URL. */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

type TestFile = { name: string; type: string; data: Buffer };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2000, 7)]);
const OGG = Buffer.concat([Buffer.from("OggS\0\x02"), Buffer.alloc(1000, 3)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(1000, 5)]);
const agent1 = `dev:${uid(1)}:AGENT`;
const agent2 = `dev:${uid(2)}:AGENT`;
const supervisor = `dev:${uid(9)}:SUPERVISOR`;
const customer = `dev:${uid(100)}:CUSTOMER`;

describe.skipIf(!url)("attachments over HTTP", () => {
  let server: Server;
  let base: string;
  let storageDir: string;
  let db: typeof import("@config/database.js").prisma;
  let cid: string;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "chat-test-uploads-"));
    process.env.DATABASE_URL = url as string;
    process.env.AUTH_MODE = "dev";
    process.env.EVENT_BUS = "memory";
    process.env.STORAGE_DIR = storageDir;
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    const { app } = await import("../../../app.js");
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/admin`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await db?.$disconnect();
    await rm(storageDir, { recursive: true, force: true });
  });

  const json = async (path: string, token: string | null, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const form = (token: string | null, path: string, fields: Record<string, string>, file?: TestFile) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    if (file) data.set("file", new Blob([file.data as unknown as BlobPart], { type: file.type }), file.name);
    return fetch(`${base}${path}`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: data,
    });
  };
  const sendFile = async (
    token: string | null,
    clientId = "c1",
    file: TestFile = { name: "scan.png", type: "image/png", data: PNG },
    extra = {},
  ) => {
    const response = await form(token, "/attachments/upload", { conversationId: cid, clientId, ...extra }, file);
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const list = () => readdir(storageDir, { recursive: true }).catch(() => [] as string[]); // the directory only exists once something was stored
  const stored = async () => (await list()).filter((name) => /\.\w+$/.test(name));

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags RESTART IDENTITY CASCADE`;
    await rm(storageDir, { recursive: true, force: true });
    cid = (
      await json("/conversations", agent1, "POST", {
        customerId: uid(100),
        applicationId: 7,
        customerName: "Maya",
        priority: "MEDIUM",
      })
    ).body.data.id;
    await json(`/conversations/${cid}/assign`, agent1, "POST", {});
  });

  it("uploads a file as a message and lists it in history and in shared media", async () => {
    const { status, body } = await sendFile(agent1, "c1", undefined, { text: "ID photo" });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ type: "IMAGE", content: "ID photo", senderId: uid(1) });
    const file = body.data.attachments[0];
    expect(file).toMatchObject({
      fileName: "scan.png",
      mimeType: "image/png",
      fileSize: PNG.length,
      kind: "IMAGE",
      messageId: body.data.id,
    });
    expect(file.downloadPath).toBe(`/attachments/${file.id}/download`);

    const history = await json(`/conversations/${cid}/messages`, agent1);
    expect(history.body.data.find((m: any) => m.id === body.data.id).attachments).toHaveLength(1);
    const media = await json(`/conversations/${cid}/attachments?kind=image`, agent1);
    expect(media.body.data.map((a: any) => a.id)).toEqual([file.id]);
    expect(media.body.meta.total).toBe(1);
    expect((await json(`/conversations/${cid}/attachments?kind=document`, agent1)).body.data).toEqual([]);
    expect((await json(`/conversations`, agent1)).body.data[0].lastMessagePreview).toBe("ID photo");
    expect((await stored()).length).toBe(1);
  });

  it("is idempotent by clientId and keeps only one stored file", async () => {
    const first = await sendFile(agent1, "same");
    const retry = await sendFile(agent1, "same");
    expect([first.status, retry.status]).toEqual([201, 200]);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect((await stored()).length).toBe(1);
    expect(await db.attachment.count()).toBe(1);
  });

  it("downloads the exact bytes with safe headers, and supports ranges", async () => {
    const id = (await sendFile(agent1)).body.data.attachments[0].id;
    const auth = { authorization: `Bearer ${agent1}` };

    const full = await fetch(`${base}/attachments/${id}/download`, { headers: auth });
    expect(full.status).toBe(200);
    expect(Buffer.from(await full.arrayBuffer()).equals(PNG)).toBe(true);
    expect(full.headers.get("content-type")).toBe("image/png");
    expect(full.headers.get("content-disposition")).toMatch(/^attachment; filename="scan.png"/);
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    expect(full.headers.get("cache-control")).toMatch(/private/);
    expect(full.headers.get("content-security-policy")).toMatch(/sandbox/);

    const inline = await fetch(`${base}/attachments/${id}/download?inline=1`, { headers: auth });
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/);
    await inline.arrayBuffer();

    const part = await fetch(`${base}/attachments/${id}/download`, { headers: { ...auth, range: "bytes=10-19" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 10-19/${PNG.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(PNG.subarray(10, 20))).toBe(true);

    const beyond = await fetch(`${base}/attachments/${id}/download`, { headers: { ...auth, range: "bytes=99999-" } });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get("content-range")).toBe(`bytes */${PNG.length}`);
    await beyond.arrayBuffer();
  });

  it("keeps files from people who may not see the conversation, and from anonymous or customer callers", async () => {
    const id = (await sendFile(agent1)).body.data.attachments[0].id;
    const path = `/attachments/${id}/download`;
    expect((await fetch(`${base}${path}`)).status).toBe(401);
    expect((await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${customer}` } })).status).toBe(403);
    expect((await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${agent2}` } })).status).toBe(404); // someone else's chat
    expect((await json(`/attachments/${id}`, agent2)).status).toBe(404);
    expect((await json(`/conversations/${cid}/attachments`, agent2)).status).toBe(404);
    expect((await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${supervisor}` } })).status).toBe(200);
    expect((await json(`/attachments/${id}`, agent1)).status).toBe(200);
  });

  it("refuses unsafe, mismatched, empty and oversized uploads and stores nothing", async () => {
    const cases: [string, TestFile, number][] = [
      ["html", { name: "x.html", type: "text/html", data: Buffer.from("<script>alert(1)</script>") }, 400],
      ["svg", { name: "x.svg", type: "image/svg+xml", data: Buffer.from("<svg onload=alert(1)/>") }, 400],
      ["renamed", { name: "x.png", type: "image/png", data: Buffer.from("<script>alert(1)</script>") }, 400],
      ["extension", { name: "x.jpg", type: "image/png", data: PNG }, 400],
      ["empty", { name: "x.png", type: "image/png", data: Buffer.alloc(0) }, 400],
      [
        "too big for an image",
        { name: "x.png", type: "image/png", data: Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]) },
        400,
      ],
    ];
    for (const [label, file, expected] of cases) {
      expect((await sendFile(agent1, `bad-${label}`, file)).status, label).toBe(expected);
    }
    const noFile = await form(agent1, "/attachments/upload", { conversationId: cid, clientId: "none" });
    expect(noFile.status).toBe(400);
    await noFile.arrayBuffer();
    expect(await stored()).toEqual([]);
    expect(await db.attachment.count()).toBe(0);
    expect(await db.message.count({ where: { senderType: "AGENT" } })).toBe(0);
  });

  it("only lets the owner of an open conversation upload, and requires a token", async () => {
    expect((await sendFile(null)).status).toBe(401);
    expect((await sendFile(agent2)).status).toBe(404);
    expect((await sendFile(supervisor)).status).toBe(403); // sees it, but does not own it
    await json(`/conversations/${cid}/status`, agent1, "PATCH", { status: "CLOSED" });
    expect((await sendFile(agent1)).status).toBe(403);
    expect(await stored()).toEqual([]);
  });

  it("stores a voice message with its duration and waveform, and plays it back with ranges", async () => {
    const response = await form(
      agent1,
      `/conversations/${cid}/voice-messages`,
      { clientId: "v1", durationMs: "4200", waveform: JSON.stringify([10, 80, 255, 0]) },
      { name: "voice.webm", type: "audio/webm;codecs=opus", data: WEBM },
    );
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: any };
    expect(data).toMatchObject({ type: "VOICE", content: null });
    expect(data.attachments[0]).toMatchObject({
      kind: "AUDIO",
      mimeType: "audio/webm",
      durationMs: 4200,
      waveform: [10, 80, 255, 0],
    });
    expect((await json(`/conversations/${cid}/attachments?kind=voice`, agent1)).body.data).toHaveLength(1);
    expect((await json(`/conversations/${cid}`, agent1)).body.data.lastMessagePreview).toBe("Voice message");

    const audio = await fetch(`${base}/messages/${data.id}/audio`, {
      headers: { authorization: `Bearer ${agent1}`, range: "bytes=0-99" },
    });
    expect(audio.status).toBe(206);
    expect(audio.headers.get("content-type")).toBe("audio/webm");
    expect(audio.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(Buffer.from(await audio.arrayBuffer()).equals(WEBM.subarray(0, 100))).toBe(true);
    expect(
      (await fetch(`${base}/messages/${data.id}/audio`, { headers: { authorization: `Bearer ${agent2}` } })).status,
    ).toBe(404);
  });

  it("rejects voice messages that are not audio, or have bad metadata", async () => {
    const png = { name: "v.png", type: "image/png", data: PNG };
    expect((await form(agent1, `/conversations/${cid}/voice-messages`, { clientId: "v1" }, png)).status).toBe(400);
    const ogg = { name: "v.ogg", type: "audio/ogg", data: OGG };
    expect(
      (await form(agent1, `/conversations/${cid}/voice-messages`, { clientId: "v2", durationMs: "-5" }, ogg)).status,
    ).toBe(400);
    expect(
      (await form(agent1, `/conversations/${cid}/voice-messages`, { clientId: "v3", waveform: "not json" }, ogg))
        .status,
    ).toBe(400);
    expect(
      (
        await form(
          agent1,
          `/conversations/${cid}/voice-messages`,
          { clientId: "v4", waveform: JSON.stringify([300]) },
          ogg,
        )
      ).status,
    ).toBe(400);
    expect(await stored()).toEqual([]);
  });

  it("deletes a file: gone from lists and downloads, bytes and record kept; only uploader or supervisor", async () => {
    const id = (await sendFile(agent1)).body.data.attachments[0].id;
    expect((await json(`/attachments/${id}`, agent2, "DELETE")).status).toBe(404);
    expect((await json(`/attachments/${id}`, agent1, "DELETE")).status).toBe(200);

    expect((await json(`/attachments/${id}`, agent1)).status).toBe(404);
    expect(
      (await fetch(`${base}/attachments/${id}/download`, { headers: { authorization: `Bearer ${agent1}` } })).status,
    ).toBe(404);
    expect((await json(`/conversations/${cid}/attachments`, agent1)).body.data).toEqual([]);
    expect((await stored()).length).toBe(1);
    expect((await db.attachment.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    expect((await json(`/attachments/${id}`, agent1, "DELETE")).status).toBe(404);
  });

  it("makes a message's files unavailable when the message is deleted", async () => {
    const sent = (await sendFile(agent1)).body.data;
    expect((await json(`/messages/${sent.id}`, agent1, "DELETE")).status).toBe(200);
    expect(
      (
        await fetch(`${base}/attachments/${sent.attachments[0].id}/download`, {
          headers: { authorization: `Bearer ${agent1}` },
        })
      ).status,
    ).toBe(404);
    expect((await json(`/conversations/${cid}/attachments`, agent1)).body.data).toEqual([]);
  });

  it("never leaks a file name into the storage path", async () => {
    await sendFile(agent1, "evil", { name: "../../../../tmp/pwned.png", type: "image/png", data: PNG });
    const names = await list();
    expect(names.every((name) => !name.includes("pwned"))).toBe(true);
    expect((await db.attachment.findFirstOrThrow()).fileName).toBe("pwned.png");
    expect((await db.attachment.findFirstOrThrow()).storageKey).toMatch(
      /^conversations\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/,
    );
  });
});
