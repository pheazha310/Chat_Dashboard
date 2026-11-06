import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "../../../__tests__/support/container.js";
import { uid } from "../../../__tests__/support/ids.js";

/** Internal notes and escalations over real HTTP and PostgreSQL. Needs TEST_DATABASE_URL. */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

const agent1 = `dev:${uid(1)}:AGENT`;
const agent2 = `dev:${uid(2)}:AGENT`;
const agent3 = `dev:${uid(3)}:AGENT`;
const supervisor = `dev:${uid(9)}:SUPERVISOR`;
const customer = `dev:${uid(100)}:CUSTOMER`;

describe.skipIf(!url)("internal notes and escalations over HTTP", () => {
  let server: Server;
  let base: string;
  let db: typeof import("@config/database.js").prisma;
  let cid: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url as string;
    process.env.AUTH_MODE = "dev";
    process.env.EVENT_BUS = "memory";
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
  });

  const call = async (path: string, token: string | null, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE conversations, notifications, notification_preferences, tags RESTART IDENTITY CASCADE`;
    cid = (
      await call("/conversations", agent1, "POST", {
        customerId: uid(100),
        applicationId: uid(7),
        customerName: "Maya",
        priority: "MEDIUM",
      })
    ).body.data.id;
    await call(`/conversations/${cid}/assign`, agent1, "POST", {});
  });

  describe("notes", () => {
    const addNote = (token: string | null, text: string, mentionedAgentIds: string[] = []) =>
      call(`/conversations/${cid}/notes`, token, "POST", { text, mentionedAgentIds });

    it("creates, lists, edits and deletes a note, with permissions per caller", async () => {
      const created = await addNote(agent1, "Customer prefers calls after 5pm");
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        authorAgentId: uid(1),
        content: "Customer prefers calls after 5pm",
        isEdited: false,
        mentionedAgentIds: [],
        permissions: { canEdit: true, canDelete: true },
      });
      const id = created.body.data.id;

      const asSupervisor = await call(`/conversations/${cid}/notes`, supervisor);
      expect(asSupervisor.body.data[0].permissions).toEqual({ canEdit: false, canDelete: true });
      expect(asSupervisor.body.meta.total).toBe(1);

      expect((await call(`/notes/${id}`, supervisor, "PATCH", { text: "x" })).status).toBe(403);
      const edited = await call(`/notes/${id}`, agent1, "PATCH", { text: "Prefers calls after 6pm" });
      expect(edited.body.data).toMatchObject({ content: "Prefers calls after 6pm", isEdited: true });

      expect((await call(`/notes/${id}`, supervisor, "DELETE")).status).toBe(200);
      expect((await call(`/conversations/${cid}/notes`, agent1)).body.data).toEqual([]);
      expect((await call(`/notes/${id}`, agent1, "DELETE")).status).toBe(404);
      expect((await db.internalNote.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull(); // kept for audit
    });

    it("never appears in message history, shared media or previews", async () => {
      await call(`/conversations/${cid}/messages`, agent1, "POST", { clientId: "m1", text: "Hello Maya" });
      await addNote(agent1, "SECRET-NOTE-TEXT");

      const history = await call(`/conversations/${cid}/messages`, agent1);
      expect(JSON.stringify(history.body)).not.toContain("SECRET-NOTE-TEXT");
      expect(await db.message.count({ where: { content: { contains: "SECRET" } } })).toBe(0);
      const detail = await call(`/conversations/${cid}`, agent1);
      expect(JSON.stringify(detail.body)).not.toContain("SECRET-NOTE-TEXT");
      expect(detail.body.data.lastMessagePreview).toBe("Hello Maya");
    });

    it("writes a timeline entry that does not contain the note text", async () => {
      await addNote(agent1, "SECRET-NOTE-TEXT");
      const activities = await call(`/conversations/${cid}/activities`, agent1);
      const entry = activities.body.data.find((a: any) => a.activityType === "NOTE_ADDED");
      expect(entry).toMatchObject({ actorId: uid(1), description: "Internal note added" });
      expect(JSON.stringify(entry)).not.toContain("SECRET");
    });

    it("keeps notes away from agents who cannot see the conversation, and from customers and anonymous callers", async () => {
      const id = (await addNote(agent1, "private")).body.data.id;
      expect((await call(`/conversations/${cid}/notes`, agent2)).status).toBe(404);
      expect((await addNote(agent2, "sneaky")).status).toBe(404);
      expect((await call(`/notes/${id}`, agent2, "PATCH", { text: "x" })).status).toBe(404);
      expect((await call(`/notes/${id}`, agent2, "DELETE")).status).toBe(404);
      expect((await call(`/conversations/${cid}/notes`, customer)).status).toBe(403);
      expect((await addNote(customer, "hi")).status).toBe(403);
      expect((await call(`/conversations/${cid}/notes`, null)).status).toBe(401);
      expect(await db.internalNote.count()).toBe(1);
    });

    it("refuses to mention an agent who cannot see the conversation, and stores nothing", async () => {
      // The chat is owned by agent 1, so agent 2 cannot open it; a notification would leak it.
      const blocked = await addNote(agent1, "ping", [uid(2)]);
      expect(blocked.status).toBe(400);
      expect(blocked.body.error.details.agentIds).toEqual([uid(2)]);
      expect(await db.internalNote.count()).toBe(0);
      expect(await db.conversationActivity.count({ where: { activityType: "NOTE_ADDED" } })).toBe(0);
    });

    it("lets a mentioned viewer be notified, with edits notifying only new mentions", async () => {
      await db.conversationAssignment.create({
        data: {
          conversationId: cid,
          agentId: uid(2),
          assignmentType: "VIEWER",
          assignmentAction: "ASSIGNED",
          assignedBy: uid(1),
        },
      });
      const created = await addNote(agent1, "please look at this", [uid(2), uid(1), uid(2)]);
      expect(created.status).toBe(201);
      expect(created.body.data.mentionedAgentIds).toEqual([uid(2)]);

      const inbox = await call("/notifications", agent2);
      expect(inbox.body.data).toHaveLength(1);
      expect(inbox.body.data[0]).toMatchObject({
        type: "MENTION",
        conversationId: cid,
        body: "please look at this",
      });
      expect((await call("/notifications", agent1)).body.data).toEqual([]);
      expect(await db.noteMention.count()).toBe(1);

      const id = created.body.data.id;
      await call(`/notes/${id}`, agent1, "PATCH", { text: "please look again" }); // same mentions
      expect((await call("/notifications", agent2)).body.data).toHaveLength(1);

      const dropped = await call(`/notes/${id}`, agent1, "PATCH", { mentionedAgentIds: [] });
      expect(dropped.body.data.mentionedAgentIds).toEqual([]);
      expect(await db.noteMention.count()).toBe(0);
    });

    it("respects the mentioned agent's notification preference", async () => {
      await db.conversationAssignment.create({
        data: {
          conversationId: cid,
          agentId: uid(2),
          assignmentType: "VIEWER",
          assignmentAction: "ASSIGNED",
          assignedBy: uid(1),
        },
      });
      await call("/notifications/preferences", agent2, "PUT", {
        newMessage: true,
        assignment: true,
        transfer: true,
        mention: false,
        sound: true,
        browser: true,
      });
      expect((await addNote(agent1, "quiet", [uid(2)])).status).toBe(201);
      expect((await call("/notifications", agent2)).body.data).toEqual([]);
      expect(await db.noteMention.count()).toBe(1); // still recorded as a mention
    });

    it("validates the body", async () => {
      expect((await addNote(agent1, "   ")).status).toBe(400);
      expect((await addNote(agent1, "x".repeat(4001))).status).toBe(400);
      expect(
        (await call(`/conversations/${cid}/notes`, agent1, "POST", { text: "x", mentionedAgentIds: ["nope"] })).status,
      ).toBe(400);
      expect((await call(`/notes/${uid(55)}`, agent1, "PATCH", {})).status).toBe(400);
    });
  });

  describe("escalations", () => {
    const escalate = (token: string | null, reason?: string) =>
      call(`/conversations/${cid}/escalations`, token, "POST", reason === undefined ? {} : { reason });

    it("records the escalation and its timeline entry, and lists the history", async () => {
      const response = await escalate(agent1, "Customer threatens to complain");
      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        conversationId: cid,
        requestedBy: uid(1),
        reason: "Customer threatens to complain",
        status: "PENDING",
        resolvedAt: null,
      });
      const activities = await call(`/conversations/${cid}/activities`, agent1);
      const entry = activities.body.data.find((a: any) => a.activityType === "ESCALATED");
      expect(entry).toMatchObject({
        actorId: uid(1),
        metadata: { escalationId: response.body.data.id, action: "requested" },
      });
      expect((await call(`/conversations/${cid}/escalations`, supervisor)).body.data).toHaveLength(1);

      const conversation = await db.conversation.findUniqueOrThrow({ where: { id: cid } });
      expect(conversation).toMatchObject({ assignedAgentId: uid(1), status: "OPEN", priority: "MEDIUM" }); // nothing else changes
    });

    it("lets only one of several simultaneous requests win", async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => escalate(agent1, "now")));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
      expect(await db.conversationEscalation.count()).toBe(1);
      expect(await db.conversationActivity.count({ where: { activityType: "ESCALATED" } })).toBe(1);
    });

    it("allows only the owner of an open conversation", async () => {
      expect((await escalate(agent2)).status).toBe(404); // cannot see it
      expect((await escalate(supervisor)).status).toBe(403);
      expect((await escalate(customer)).status).toBe(403);
      expect((await escalate(null)).status).toBe(401);
      await call(`/conversations/${cid}/status`, agent1, "PATCH", { status: "CLOSED" });
      expect((await escalate(agent1)).status).toBe(403);
      expect(await db.conversationEscalation.count()).toBe(0);
    });

    it("is resolved by a supervisor, which allows a new escalation, and cannot be closed twice", async () => {
      const id = (await escalate(agent1)).body.data.id;
      expect((await call(`/escalations/${id}`, agent1, "PATCH", { status: "RESOLVED" })).status).toBe(403);
      expect((await call(`/escalations/${id}`, agent2, "PATCH", { status: "CANCELLED" })).status).toBe(404);

      const resolved = await call(`/escalations/${id}`, supervisor, "PATCH", { status: "RESOLVED" });
      expect(resolved.status).toBe(200);
      expect(resolved.body.data).toMatchObject({ status: "RESOLVED", resolvedBy: uid(9) });
      expect((await call(`/escalations/${id}`, supervisor, "PATCH", { status: "RESOLVED" })).status).toBe(409);
      expect((await call(`/escalations/${id}`, agent1, "PATCH", { status: "CANCELLED" })).status).toBe(409);

      expect((await escalate(agent1, "again")).status).toBe(201);
      const history = await call(`/conversations/${cid}/escalations`, agent1);
      expect(history.body.data.map((e: any) => e.status)).toEqual(["PENDING", "RESOLVED"]);
    });

    it("lets the requester cancel, but not another agent who can see the chat", async () => {
      await db.conversationAssignment.create({
        data: {
          conversationId: cid,
          agentId: uid(3),
          assignmentType: "VIEWER",
          assignmentAction: "ASSIGNED",
          assignedBy: uid(1),
        },
      });
      const id = (await escalate(agent1)).body.data.id;
      expect((await call(`/escalations/${id}`, agent3, "PATCH", { status: "CANCELLED" })).status).toBe(403);
      expect((await call(`/escalations/${id}`, agent1, "PATCH", { status: "CANCELLED" })).body.data.status).toBe(
        "CANCELLED",
      );
    });

    it("rejects invalid statuses", async () => {
      const id = (await escalate(agent1)).body.data.id;
      expect((await call(`/escalations/${id}`, supervisor, "PATCH", { status: "PENDING" })).status).toBe(400);
    });
  });
});
