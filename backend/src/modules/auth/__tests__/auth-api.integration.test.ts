import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "../../../__tests__/support/container.js";

/** Sign-in, refresh, accounts and protected routes over real HTTP and PostgreSQL. Needs TEST_DATABASE_URL. */
const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a *test* database");

describe.skipIf(!url)("authentication over HTTP", () => {
  let server: Server;
  let origin: string;
  let db: typeof import("@config/database.js").prisma;
  let users: typeof import("../../../app-container.js").userService;

  let losKey: CryptoKey;
  const LOS_ISSUER = "https://los.integration.test";

  beforeAll(async () => {
    const keys = await generateKeyPair("RS256");
    losKey = keys.privateKey;
    process.env.LOS_ISSUER = LOS_ISSUER;
    process.env.LOS_PUBLIC_KEY = await exportSPKI(keys.publicKey);
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
    await db.$executeRaw`TRUNCATE users, refresh_tokens, chat_users CASCADE`;
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
    return {
      status: response.status,
      headers: response.headers,
      body: (text ? JSON.parse(text) : null) as Record<string, any>,
    };
  };
  const staffLogin = (username: string, password: string) =>
    call("/api/v1/admin/auth/login", { body: { username, password } });

  it("has no development sign-in with AUTH_MODE=jwt", async () => {
    expect((await call("/api/v1/dev/login", { body: { type: "staff", role: "admin" } })).status).toBe(404);
  });

  it("signs an admin in, serves protected routes with the token and refuses without it", async () => {
    const login = await staffLogin("Admin@Example.com", "admin-password");
    expect(login.status).toBe(200);
    expect(login.headers.get("cache-control")).toBe("no-store");
    const { accessToken } = login.body.data;

    expect((await call("/api/v1/admin/auth/me", { token: accessToken })).body.data).toMatchObject({
      username: "admin",
      role: "ADMIN",
    });
    expect((await call("/api/v1/admin/conversations", { token: accessToken })).status).toBe(200);
    expect((await call("/api/v1/admin/conversations")).status).toBe(401);
    expect(
      (await call("/api/v1/admin/conversations", { token: "dev:00000000-0000-4000-8000-000000000001:ADMIN" })).status,
    ).toBe(401);
    // The password hash is stored, never the password.
    const row = await db.authUser.findUniqueOrThrow({ where: { username: "admin" } });
    expect(row.passwordHash).toMatch(/^scrypt\$/);
  });

  it("lets an admin create an agent who can then sign in; agents cannot manage accounts", async () => {
    const admin = (await staffLogin("admin", "admin-password")).body.data.accessToken;
    const created = await call("/api/v1/admin/users", {
      token: admin,
      body: { username: "agent", displayName: "Agent", role: "AGENT", password: "agent-password" },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).not.toHaveProperty("passwordHash");

    const agent = (await staffLogin("agent@example.com", "agent-password")).body.data.accessToken;
    expect((await call("/api/v1/admin/users", { token: agent })).status).toBe(403);
    expect((await call("/api/v1/admin/users?role=AGENT", { token: admin })).body.meta.total).toBe(1);

    // Names now come from the users table (BACKEND1_MODE=local).
    expect((await call("/api/v1/admin/agents/me", { token: agent })).body.data.profile).toEqual({
      id: created.body.data.id,
      name: "Agent",
      avatarUrl: null,
    });
  });

  it("disabling an agent ends their sign-in and refuses their access token", async () => {
    const admin = (await staffLogin("admin", "admin-password")).body.data.accessToken;
    const { id } = (
      await call("/api/v1/admin/users", {
        token: admin,
        body: { username: "agent", displayName: "Agent", role: "AGENT", password: "agent-password" },
      })
    ).body.data;
    const agent = (await staffLogin("agent@example.com", "agent-password")).body.data;
    // The agent has not used the API yet: no cached identity, so the refusal is immediate.
    expect(
      (await call(`/api/v1/admin/users/${id}`, { method: "PATCH", token: admin, body: { status: "DISABLED" } })).status,
    ).toBe(200);
    expect((await call("/api/v1/admin/auth/me", { token: agent.accessToken })).status).toBe(403);
    expect((await call("/api/v1/admin/auth/refresh", { body: { refreshToken: agent.refreshToken } })).status).toBe(401);
    expect((await staffLogin("agent@example.com", "agent-password")).status).toBe(403);
  });

  it("rotates refresh tokens and revokes the sign-in when an old one is replayed", async () => {
    const first = (await staffLogin("admin", "admin-password")).body.data;
    const second = await call("/api/v1/admin/auth/refresh", { body: { refreshToken: first.refreshToken } });
    expect(second.status).toBe(200);
    expect((await call("/api/v1/admin/auth/refresh", { body: { refreshToken: first.refreshToken } })).status).toBe(401);
    expect(
      (await call("/api/v1/admin/auth/refresh", { body: { refreshToken: second.body.data.refreshToken } })).status,
    ).toBe(401);
    expect(await db.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    const chain = await db.refreshToken.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, replacedById: true },
    });
    expect(chain).toHaveLength(2);
    expect(chain[0]?.replacedById).toBe(chain[1]?.id);
    expect(chain[1]?.replacedById).toBeNull();
  });

  it("keeps a chat user's kind equal to its role's kind", async () => {
    const admin = await db.chatUser.findFirstOrThrow({ select: { id: true, userType: true } });
    expect(admin.userType).toBe("STAFF");
    const customerRole = await db.role.findUniqueOrThrow({ where: { name: "CUSTOMER" }, select: { id: true } });
    await expect(
      db.$executeRaw`UPDATE chat_users SET role_id = ${customerRole.id} WHERE id = ${admin.id}::uuid`,
    ).rejects.toThrow(/chat_users_role_id_user_type_fkey/);
  });

  it("signs customers and staff in with LOS tokens into LOS-only accounts", async () => {
    const losToken = (claims: Record<string, unknown>, audience: string) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(LOS_ISSUER)
        .setAudience(audience)
        .setExpirationTime("2m")
        .setJti(crypto.randomUUID())
        .sign(losKey);
    const customerToken = await losToken(
      { userId: 2, username: "dara", type: "customer", tokenType: "access" },
      "luyleun",
    );
    const first = await call("/api/v1/customer/auth/los", { body: { losToken: customerToken } });
    expect(first.status).toBe(200);
    expect(first.body.data.user).toMatchObject({ username: null, losUserId: 2, role: "CUSTOMER", displayName: "dara" });
    const again = await call("/api/v1/customer/auth/los", { body: { losToken: customerToken } });
    expect(again.body.data.user.id).toBe(first.body.data.user.id);
    expect((await call("/api/v1/customer/me", { token: first.body.data.accessToken })).status).toBe(200);
    const identity = await db.chatUser.findUniqueOrThrow({ where: { externalId: first.body.data.user.id } });
    expect(identity).toMatchObject({ losUserId: 2, userType: "CUSTOMER" });

    // A customer token is refused on the staff endpoint, and a hand-off token on the customer one.
    expect((await call("/api/v1/admin/auth/los", { body: { handoffToken: customerToken } })).status).toBe(401);
    const handoff = await losToken(
      { userId: 2, username: "sophea", type: "staff", tokenType: "chat-handoff", role: "agent" },
      "chat",
    );
    expect((await call("/api/v1/customer/auth/los", { body: { losToken: handoff } })).status).toBe(401);
    const staff = await call("/api/v1/admin/auth/los", { body: { handoffToken: handoff } });
    expect(staff.status).toBe(200);
    expect(staff.body.data.user).toMatchObject({ role: "AGENT", losUserId: 2 });
    expect(staff.body.data.user.id).not.toBe(first.body.data.user.id);
    // A hand-off token signs in once.
    expect((await call("/api/v1/admin/auth/los", { body: { handoffToken: handoff } })).status).toBe(401);

    // The database keeps the account shapes honest.
    await expect(
      db.$executeRaw`UPDATE users SET los_user_id = NULL, los_user_type = NULL WHERE username IS NULL`,
    ).rejects.toThrow(/users_has_sign_in/);
    await expect(
      db.$executeRaw`UPDATE users SET username = 'x-user' WHERE id = ${staff.body.data.user.id}::uuid`,
    ).rejects.toThrow(/users_password_needs_username/);
    await expect(
      db.$executeRaw`UPDATE users SET los_user_type = 'CUSTOMER' WHERE id = ${staff.body.data.user.id}::uuid`,
    ).rejects.toThrow(/users_los_user_type_matches_role/);
  });

  it("keeps a staff or customer profile row with every account, editable by admins", async () => {
    const { accessToken } = (await staffLogin("admin", "admin-password")).body.data;
    const created = await call("/api/v1/admin/users", {
      token: accessToken,
      body: {
        username: "agent",
        displayName: "Agent",
        role: "AGENT",
        password: "agent-password",
        staff: { employeeCode: "E-1", department: "Loans" },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ staff: { employeeCode: "E-1", department: "Loans" }, customer: null });
    const taken = await call("/api/v1/admin/users", {
      token: accessToken,
      body: {
        username: "b",
        displayName: "B",
        role: "AGENT",
        password: "agent-password",
        staff: { employeeCode: "E-1" },
      },
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toMatch(/employee code/);

    const registered = await call("/api/v1/customer/auth/register", {
      body: { username: "cust", password: "customer-pass", displayName: "Cust" },
    });
    const customerId = registered.body.data.user.id;
    expect(registered.body.data.user.customer).toEqual({ phone: null, customerCode: null, preferredLanguage: null });
    const patched = await call(`/api/v1/admin/users/${customerId}`, {
      method: "PATCH",
      token: accessToken,
      body: { customer: { phone: "+85512345678", preferredLanguage: "km" } },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.customer).toMatchObject({ phone: "+85512345678", preferredLanguage: "km" });
    const wrongKind = await call(`/api/v1/admin/users/${customerId}`, {
      method: "PATCH",
      token: accessToken,
      body: { staff: { department: "Loans" } },
    });
    expect(wrongKind.status).toBe(400);

    // Every account has exactly its own kind of row; the database checks the values and deletes rows with the account.
    expect(await db.staff.count()).toBe(2);
    expect(await db.customer.count()).toBe(1);
    await expect(
      db.$executeRaw`UPDATE customers SET phone = '012345678' WHERE user_id = ${customerId}::uuid`,
    ).rejects.toThrow(/customers_phone_e164/);
    await expect(db.$executeRaw`UPDATE staff SET max_concurrent_chats = 0`).rejects.toThrow(
      /staff_max_concurrent_chats_positive/,
    );
    await db.$executeRaw`DELETE FROM users WHERE id = ${customerId}::uuid`;
    expect(await db.customer.count()).toBe(0);
  });

  it("keeps a refreshed sign-in's end and prunes expired sessions at the next sign-in", async () => {
    const first = (await staffLogin("admin", "admin-password")).body.data;
    const refreshed = (await call("/api/v1/admin/auth/refresh", { body: { refreshToken: first.refreshToken } })).body
      .data;
    expect(refreshed.refreshTokenExpiresAt).toBe(first.refreshTokenExpiresAt);
    await db.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await staffLogin("admin", "admin-password");
    expect(await db.refreshToken.count()).toBe(1);
  });

  it("deletes every user's expired sessions in batches (the cleanup job's SQL), and only those", async () => {
    const { authService } = await import("../../../app-container.js");
    const admin = await db.authUser.findUniqueOrThrow({ where: { username: "admin" } });
    const session = (expiresAt: Date, revokedAt: Date | null = null) => ({
      userId: admin.id,
      familyId: crypto.randomUUID(),
      tokenHash: crypto.randomUUID().replace(/-/g, "").padEnd(64, "0"),
      expiresAt,
      revokedAt,
    });
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 60_000);
    await db.refreshToken.createMany({
      data: [session(past), session(past), session(past, past), session(future), session(future, new Date())],
    });
    // Batches of 2: three expired rows take two passes; the live and the revoked-but-unexpired rows stay.
    await expect(authService.pruneExpiredSessions(2)).resolves.toEqual({ deletedSessions: 3 });
    expect(await db.refreshToken.count()).toBe(2);
    expect(await db.refreshToken.count({ where: { expiresAt: { lt: new Date() } } })).toBe(0);
  });

  it("locks an account after 5 wrong passwords", async () => {
    for (let i = 0; i < 5; i++) expect((await staffLogin("admin", "wrong")).status).toBe(401);
    const locked = await staffLogin("admin", "admin-password");
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("ACCOUNT_LOCKED");
  });

  it("registers a mobile customer who can use the customer API but not the dashboard", async () => {
    const registered = await call("/api/v1/customer/auth/register", {
      body: { username: "cus", password: "customer-pass", displayName: "Cus" },
    });
    expect(registered.status).toBe(201);
    const { accessToken, refreshToken } = registered.body.data;
    expect((await call("/api/v1/customer/auth/me", { token: accessToken })).body.data.role).toBe("CUSTOMER");
    expect((await call("/api/v1/admin/conversations", { token: accessToken })).status).toBe(403);
    expect((await staffLogin("cus@example.com", "customer-pass")).status).toBe(401);
    expect((await call("/api/v1/admin/auth/refresh", { body: { refreshToken } })).status).toBe(401);
    expect(
      (await call("/api/v1/customer/auth/login", { body: { username: "cus", password: "customer-pass" } })).status,
    ).toBe(200);
    expect(
      (
        await call("/api/v1/customer/auth/register", {
          body: { username: "CUS", password: "customer-pass", displayName: "Again" },
        })
      ).status,
    ).toBe(409);
  });

  it("changes a password: the old one stops working and other devices are signed out", async () => {
    const laptop = (await staffLogin("admin", "admin-password")).body.data;
    const phone = (await staffLogin("admin", "admin-password")).body.data;
    const changed = await call("/api/v1/admin/auth/me/password", {
      token: phone.accessToken,
      body: { currentPassword: "admin-password", newPassword: "admin-password-2" },
    });
    expect(changed.status).toBe(200);
    expect((await call("/api/v1/admin/auth/refresh", { body: { refreshToken: laptop.refreshToken } })).status).toBe(
      401,
    );
    expect((await staffLogin("admin", "admin-password")).status).toBe(401);
    expect((await staffLogin("admin", "admin-password-2")).status).toBe(200);
  });

  it("lets an admin change what a role may do; the next sign-in of that role gets it", async () => {
    const admin = (await staffLogin("admin", "admin-password")).body.data.accessToken;
    const roles = (await call("/api/v1/admin/roles", { token: admin })).body.data as { id: number; name: string }[];
    const agentRole = roles.find((role) => role.name === "AGENT")!;
    const adminRole = roles.find((role) => role.name === "ADMIN")!;
    expect((await call("/api/v1/admin/permissions", { token: admin })).body.data.length).toBeGreaterThan(20);

    for (const [username, name] of [
      ["one", "One"],
      ["two", "Two"],
    ]) {
      await call("/api/v1/admin/users", {
        token: admin,
        body: { username, displayName: name, role: "AGENT", password: "agent-password" },
      });
    }
    const tag = (await call("/api/v1/admin/tags", { token: admin, body: { name: "VIP" } })).body.data;
    const setAgent = (permissions: string[]) =>
      call(`/api/v1/admin/roles/${agentRole.id}/permissions`, { method: "PUT", token: admin, body: { permissions } });

    try {
      const one = (await staffLogin("one@example.com", "agent-password")).body.data.accessToken;
      expect((await call(`/api/v1/admin/tags/${tag.id}`, { method: "DELETE", token: one })).status).toBe(403);
      expect(
        (
          await call(`/api/v1/admin/roles/${agentRole.id}/permissions`, {
            method: "PUT",
            token: one,
            body: { permissions: [] },
          })
        ).status,
      ).toBe(403);

      expect((await setAgent(["tags.delete"])).body.data.permissions).toEqual(["tags.delete"]);
      const two = (await staffLogin("two@example.com", "agent-password")).body.data.accessToken;
      expect((await call(`/api/v1/admin/tags/${tag.id}`, { method: "DELETE", token: two })).status).toBe(200);

      const lockout = await call(`/api/v1/admin/roles/${adminRole.id}/permissions`, {
        method: "PUT",
        token: admin,
        body: { permissions: [] },
      });
      expect(lockout.status).toBe(400);
    } finally {
      await setAgent([]);
    }
  });

  it("keeps the chat identity in step with the account: name, role, and one row per account", async () => {
    const admin = (await staffLogin("admin", "admin-password")).body.data.accessToken;
    const created = (
      await call("/api/v1/admin/users", {
        token: admin,
        body: { username: "sam", displayName: "Sam", role: "AGENT", password: "agent-password" },
      })
    ).body.data;
    await call(`/api/v1/admin/users/${created.id}`, {
      method: "PATCH",
      token: admin,
      body: { displayName: "Sam Lead", role: "SUPERVISOR" },
    });
    const row = await db.chatUser.findUnique({ where: { externalId: created.id }, include: { role: true } });
    expect(row).toMatchObject({ userType: "STAFF", username: "Sam Lead", role: { name: "SUPERVISOR" } });
  });
});
