import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "../../../__tests__/support/container.js";

/**
 * Seam C: standalone mode over real HTTP and PostgreSQL. LOS_BASE_URL points at a port nothing listens on, so LOS is
 * down for the whole file: chat sign-in, linking, sessions and the audit trail must all work regardless.
 * Needs TEST_DATABASE_URL.
 */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

describe.skipIf(!url)("standalone mode over HTTP", () => {
  let server: Server;
  let origin: string;
  let db: typeof import("@config/database.js").prisma;
  let users: typeof import("../../../app-container.js").userService;
  let losKey: CryptoKey;
  const LOS_ISSUER = "https://los.integration.test";

  beforeAll(async () => {
    const keys = await generateKeyPair("RS256");
    losKey = keys.privateKey;
    process.env.DOTENV_CONFIG_PATH = "/dev/null"; // hermetic: a developer's backend/.env must not leak in (e.g. LOS_JWKS_URL)
    process.env.LOS_ISSUER = LOS_ISSUER;
    process.env.LOS_PUBLIC_KEY = await exportSPKI(keys.publicKey);
    process.env.LOS_BASE_URL = "http://127.0.0.1:1"; // nothing listens here: LOS is down
    process.env.DATABASE_URL = url as string;
    process.env.AUTH_MODE = "jwt";
    process.env.EVENT_BUS = "memory";
    process.env.BACKEND1_MODE = "local";
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = "1000";
    process.env.JWT_SECRET = "integration-test-secret-0123456789abcdef";
    db = (await import("@config/database.js")).prisma;
    await assertTestDatabase(db);
    users = (await import("../../../app-container.js")).userService;
    const { app } = await import("../../../app.js");
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE users, refresh_tokens, chat_users, los_handoff_tokens CASCADE`;
    await users.bootstrapAdmin({ username: "admin", displayName: "Admin", password: "admin-password" });
  });

  const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
  };
  const login = (username: string, password: string, provider?: "chat") =>
    call("/api/v1/admin/auth/login", { body: { username, password, ...(provider ? { provider } : {}) } });
  const handoff = (losUserId: number, role = "agent") =>
    new SignJWT({ userId: losUserId, username: `los-${losUserId}`, type: "staff", tokenType: "chat-handoff", role })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(LOS_ISSUER)
      .setAudience("chat")
      .setIssuedAt()
      .setExpirationTime("90s")
      .setJti(crypto.randomUUID())
      .sign(losKey);

  const adminToken = async () => (await login("admin", "admin-password")).body.data.accessToken as string;
  const createAgent = async (admin: string, username = "ann") =>
    (
      await call("/api/v1/admin/users", {
        token: admin,
        body: { username, displayName: username, role: "AGENT", password: "agent-password" },
      })
    ).body.data as { id: string };

  it("signs staff in with a chat account while LOS is unreachable, and serves chat routes", async () => {
    const admin = await adminToken(); // LOS_BASE_URL is dead, so the LOS-first attempt fails and chat answers
    await createAgent(admin);
    const agent = await login("ann", "agent-password", "chat");
    expect(agent.status).toBe(200);
    expect((await call("/api/v1/admin/conversations", { token: agent.body.data.accessToken })).status).toBe(200);
    expect((await call("/api/v1/admin/users", { token: agent.body.data.accessToken })).status).toBe(403);
  });

  it("keeps an existing session working and refreshable with LOS down", async () => {
    const session = (await login("admin", "admin-password")).body.data;
    const refreshed = await call("/api/v1/admin/auth/refresh", { body: { refreshToken: session.refreshToken } });
    expect(refreshed.status).toBe(200);
    expect((await call("/api/v1/admin/auth/me", { token: refreshed.body.data.accessToken })).status).toBe(200);
  });

  it("refuses wrong passwords, unknown users and disabled accounts, and records each", async () => {
    const admin = await adminToken();
    const ann = await createAgent(admin);
    expect((await login("ann", "wrong-password", "chat")).status).toBe(401);
    expect((await login("nobody", "agent-password", "chat")).status).toBe(401);
    await call(`/api/v1/admin/users/${ann.id}`, { method: "PATCH", token: admin, body: { status: "DISABLED" } });
    expect((await login("ann", "agent-password", "chat")).status).toBe(403);

    const reasons = (
      await db.authAuditEvent.findMany({ where: { event: "LOGIN_FAILED" }, orderBy: { createdAt: "asc" } })
    ).map((row) => row.reason);
    expect(reasons).toEqual(["BAD_PASSWORD", "UNKNOWN_USER", "DISABLED"]);
    expect(await db.authAuditEvent.count({ where: { event: "SESSIONS_REVOKED", userId: ann.id } })).toBe(1);
    const stored = JSON.stringify(await db.authAuditEvent.findMany());
    expect(stored).not.toContain("agent-password");
    expect(stored).not.toContain("wrong-password");
  });

  it("links a chat account to an LOS identity so LOS sign-in lands in it, never creating a second account", async () => {
    const admin = await adminToken();
    const ann = await createAgent(admin);
    const link = await call(`/api/v1/admin/users/${ann.id}/identities`, {
      token: admin,
      body: { provider: "LOS", externalUserType: "STAFF", externalUserId: 42 },
    });
    expect(link.status).toBe(201);
    expect(link.body.data).toMatchObject({ id: ann.id, losUserId: 42, username: "ann" });

    const viaLos = await call("/api/v1/admin/auth/los", { body: { handoffToken: await handoff(42) } });
    expect(viaLos.status).toBe(200);
    expect(viaLos.body.data.user.id).toBe(ann.id);
    expect(await db.authUser.count({ where: { role: "AGENT" } })).toBe(1);
    expect(await db.chatUser.count({ where: { externalId: ann.id } })).toBe(1);

    // The same identity cannot be given to a second account; an unlinked LOS identity gets its own account.
    const bob = await createAgent(admin, "bob");
    const taken = await call(`/api/v1/admin/users/${bob.id}/identities`, {
      token: admin,
      body: { provider: "LOS", externalUserType: "STAFF", externalUserId: 42 },
    });
    expect(taken.status).toBe(409);
    const other = await call("/api/v1/admin/auth/los", { body: { handoffToken: await handoff(77) } });
    expect(other.body.data.user.id).not.toBe(ann.id);
    const linked = await db.authAuditEvent.findMany({ where: { event: "IDENTITY_LINKED" } });
    expect(linked).toHaveLength(1);
    expect(linked[0]?.actorId).not.toBeNull();
  });

  it("lets only admins link, and unlinking signs the account out but keeps its chat password", async () => {
    const admin = await adminToken();
    const ann = await createAgent(admin);
    const agent = (await login("ann", "agent-password", "chat")).body.data;
    const body = { provider: "LOS", externalUserType: "STAFF", externalUserId: 42 };
    expect((await call(`/api/v1/admin/users/${ann.id}/identities`, { token: agent.accessToken, body })).status).toBe(
      403,
    );

    await call(`/api/v1/admin/users/${ann.id}/identities`, { token: admin, body });
    const unlink = await call(`/api/v1/admin/users/${ann.id}/identities/LOS`, { method: "DELETE", token: admin });
    expect(unlink.status).toBe(200);
    expect(unlink.body.data).toMatchObject({ losUserId: null, username: "ann" });
    expect(await db.externalIdentity.count()).toBe(0);
    expect((await call("/api/v1/admin/auth/refresh", { body: { refreshToken: agent.refreshToken } })).status).toBe(401);
    expect((await login("ann", "agent-password", "chat")).status).toBe(200);
  });

  it("gives an LOS-only account chat credentials on the same account, so it works standalone", async () => {
    const admin = await adminToken();
    const viaLos = await call("/api/v1/admin/auth/los", { body: { handoffToken: await handoff(42) } });
    const id = viaLos.body.data.user.id as string;
    const body = { password: "lee-password-1", username: "lee" };
    expect(
      (await call(`/api/v1/admin/users/${id}/password`, { token: admin, body: { password: "lee-password-1" } })).status,
    ).toBe(409);
    const set = await call(`/api/v1/admin/users/${id}/password`, { token: admin, body });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ id, username: "lee", losUserId: 42 });

    const standalone = await login("lee", "lee-password-1", "chat");
    expect(standalone.status).toBe(200);
    expect(standalone.body.data.user.id).toBe(id);
    expect(await db.authUser.count({ where: { role: "AGENT" } })).toBe(1);
  });

  it("backfills and enforces the identity table in the database", async () => {
    await expect(
      db.$executeRaw`INSERT INTO external_identities (provider, external_user_id, external_user_type, chat_user_id)
        SELECT 'OTHER', '1', 'STAFF', id FROM users LIMIT 1`,
    ).rejects.toThrow(/external_identities_provider_check/);
    await expect(
      db.$executeRaw`INSERT INTO auth_audit_events (event, provider, outcome) VALUES ('LOGIN_FAILED', 'CHAT', 'MAYBE')`,
    ).rejects.toThrow(/auth_audit_events_outcome_check/);
  });
});
