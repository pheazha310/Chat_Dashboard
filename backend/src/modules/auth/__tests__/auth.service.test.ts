import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ConflictError, ForbiddenError, UnauthorizedError } from "@shared/errors/AppError.js";
import { hashPassword, verifyPassword } from "../auth.password.js";
import { AccountLockedError, AuthService } from "../auth.service.js";
import { AccessTokens, hashRefreshToken } from "../auth.tokens.js";
import type { LosIdentity, LosTokenVerifier } from "../auth.los.js";
import { DEFAULT_AUTH_OPTIONS } from "../auth.types.js";
import { FakeAuthRepository } from "./fake-auth-repository.js";

const tokens = new AccessTokens("k".repeat(40), 900);
const client = { userAgent: "vitest", ipAddress: "127.0.0.1" };
const PASSWORD = "agent-password-1";

describe("AuthService", () => {
  let repo: FakeAuthRepository;
  let service: AuthService;
  let now: Date;

  const addUser = async (username: string, role: string, status = "ACTIVE") =>
    repo
      .createUser({ username, passwordHash: await hashPassword(PASSWORD), role, displayName: username })
      .then(async (u) => (await repo.updateUser(u.id, { status })) as typeof u);

  beforeEach(() => {
    repo = new FakeAuthRepository();
    now = new Date("2026-11-07T10:00:00Z");
    service = new AuthService(repo.asRepository(), tokens, DEFAULT_AUTH_OPTIONS, () => now);
  });

  describe("login", () => {
    it("returns tokens for the right password and resets the failure count", async () => {
      const user = await addUser("ann", "AGENT");
      user.failedLoginCount = 3;
      const result = await service.login("staff", { username: "ann", password: PASSWORD }, client);

      expect(result.tokenType).toBe("Bearer");
      expect(result.user).toMatchObject({ id: user.id, username: "ann", role: "AGENT" });
      expect(result.user).not.toHaveProperty("passwordHash");
      await expect(tokens.verifyToken(result.accessToken)).resolves.toEqual({ userId: user.id, role: "AGENT" });
      expect(repo.users.get(user.id)?.failedLoginCount).toBe(0);
      // Only the hash of the refresh token is stored.
      expect(repo.sessions).toHaveLength(1);
      expect(repo.sessions[0]?.tokenHash).toBe(hashRefreshToken(result.refreshToken));
      expect(repo.sessions[0]).toMatchObject({ userAgent: "vitest", ipAddress: "127.0.0.1" });
    });

    it("answers an unknown username and a wrong password the same way", async () => {
      await addUser("ann", "AGENT");
      await expect(service.login("staff", { username: "bob", password: PASSWORD }, client)).rejects.toThrow(
        new UnauthorizedError("Invalid username or password"),
      );
      await expect(service.login("staff", { username: "ann", password: "nope" }, client)).rejects.toThrow(
        new UnauthorizedError("Invalid username or password"),
      );
      expect(repo.sessions).toHaveLength(0);
    });

    it("locks the account after 5 wrong passwords, even for the right one, until the lock ends", async () => {
      const user = await addUser("ann", "AGENT");
      for (let i = 0; i < 5; i++) {
        await expect(service.login("staff", { username: user.username, password: "wrong" }, client)).rejects.toThrow();
      }
      const locked = service.login("staff", { username: user.username, password: PASSWORD }, client);
      await expect(locked).rejects.toBeInstanceOf(AccountLockedError);
      await expect(locked).rejects.toMatchObject({ status: 429, details: { retryAfterSeconds: 900 } });

      now = new Date(now.getTime() + 15 * 60_000 + 1);
      await expect(
        service.login("staff", { username: user.username, password: PASSWORD }, client),
      ).resolves.toBeDefined();
    });

    it("refuses a customer at the staff endpoint and staff at the customer endpoint, like a wrong password", async () => {
      await addUser("cus", "CUSTOMER");
      await addUser("agent", "AGENT");
      await expect(service.login("staff", { username: "cus", password: PASSWORD }, client)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      await expect(service.login("customer", { username: "agent", password: PASSWORD }, client)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      await expect(service.login("customer", { username: "cus", password: PASSWORD }, client)).resolves.toBeDefined();
    });

    it("refuses a disabled account once the password is right", async () => {
      await addUser("ann", "AGENT", "DISABLED");
      await expect(service.login("staff", { username: "ann", password: PASSWORD }, client)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("upgrades a hash made with old parameters", async () => {
      const user = await addUser("ann", "AGENT");
      // A valid hash with a lower cost (log2 N = 14) than the current one.
      const { scryptSync, randomBytes } = await import("node:crypto");
      const salt = randomBytes(16);
      const key = scryptSync(PASSWORD, salt, 64, { N: 2 ** 14, r: 8, p: 1 });
      user.passwordHash = `scrypt$14$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
      await service.login("staff", { username: user.username, password: PASSWORD }, client);
      expect(repo.users.get(user.id)?.passwordHash).toMatch(/^scrypt\$15\$/);
    });
  });

  describe("register", () => {
    it("creates a customer and signs them in; a taken username is 409", async () => {
      const result = await service.register({ username: "new", password: "long-enough", displayName: "New" }, client);
      expect(result.user).toMatchObject({ role: "CUSTOMER", username: "new", status: "ACTIVE" });
      await expect(
        service.register({ username: "new", password: "long-enough", displayName: "Again" }, client),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("chat identity", () => {
    it("copies the name and role on registration and on every sign-in, and survives a failed copy", async () => {
      const identities = { sync: vi.fn(async () => {}) };
      service = new AuthService(repo.asRepository(), tokens, DEFAULT_AUTH_OPTIONS, () => now, identities);
      const registered = await service.register(
        { username: "dara", password: "long-enough", displayName: "Dara" },
        client,
      );
      expect(identities.sync).toHaveBeenCalledWith({
        id: registered.user.id,
        role: "CUSTOMER",
        displayName: "Dara",
        losUserId: null,
      });

      const user = await addUser("ann", "AGENT");
      identities.sync.mockRejectedValueOnce(new Error("db hiccup"));
      await expect(
        service.login("staff", { username: user.username, password: PASSWORD }, client),
      ).resolves.toBeDefined();
      expect(identities.sync).toHaveBeenLastCalledWith({
        id: user.id,
        role: "AGENT",
        displayName: user.username,
        losUserId: null,
      });
    });
  });

  describe("refresh", () => {
    it("rotates: the old refresh token stops working and the new one works", async () => {
      await addUser("ann", "AGENT");
      const first = await service.login("staff", { username: "ann", password: PASSWORD }, client);
      const second = await service.refresh("staff", first.refreshToken, client);
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(repo.live()).toHaveLength(1);
      await expect(service.refresh("staff", second.refreshToken, client)).resolves.toBeDefined();
    });

    it("links each rotated session to the one that replaced it", async () => {
      await addUser("ann", "AGENT");
      const first = await service.login("staff", { username: "ann", password: PASSWORD }, client);
      await service.refresh("staff", first.refreshToken, client);
      const [old, current] = repo.sessions;
      expect(old?.replacedById).toBe(current?.id);
      expect(current?.replacedById).toBeNull();
      expect(current?.familyId).toBe(old?.familyId);
    });

    it("revokes the whole sign-in when a used refresh token comes back", async () => {
      await addUser("ann", "AGENT");
      const first = await service.login("staff", { username: "ann", password: PASSWORD }, client);
      const second = await service.refresh("staff", first.refreshToken, client);

      await expect(service.refresh("staff", first.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
      await expect(service.refresh("staff", second.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(repo.live()).toHaveLength(0);
    });

    it("treats losing a rotation race as reuse and keeps the revocation", async () => {
      await addUser("ann", "AGENT");
      const first = await service.login("staff", { username: "ann", password: PASSWORD }, client);
      repo.loseNextRotation = true;
      await expect(service.refresh("staff", first.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(repo.live()).toHaveLength(0);
    });

    it("refuses unknown and expired tokens, disabled users and the wrong endpoint", async () => {
      const user = await addUser("ann", "AGENT");
      await expect(service.refresh("staff", "x".repeat(43), client)).rejects.toBeInstanceOf(UnauthorizedError);

      const a = await service.login("staff", { username: user.username, password: PASSWORD }, client);
      await expect(service.refresh("customer", a.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);

      const b = await service.login("staff", { username: user.username, password: PASSWORD }, client);
      user.status = "DISABLED";
      await expect(service.refresh("staff", b.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
      user.status = "ACTIVE";

      const c = await service.login("staff", { username: user.username, password: PASSWORD }, client);
      now = new Date(now.getTime() + DEFAULT_AUTH_OPTIONS.refreshTtlMs);
      await expect(service.refresh("staff", c.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("tells the client the session expired, so it can offer another sign-in, but not for an unknown token", async () => {
      const user = await addUser("ann", "AGENT");
      const session = await service.login("staff", { username: user.username, password: PASSWORD }, client);
      now = new Date(now.getTime() + DEFAULT_AUTH_OPTIONS.refreshTtlMs);
      await expect(service.refresh("staff", session.refreshToken, client)).rejects.toMatchObject({
        status: 401,
        code: "SESSION_EXPIRED",
      });
      await expect(service.refresh("staff", "x".repeat(43), client)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("logout and password change", () => {
    it("logout revokes that sign-in only; logoutAll revokes every one", async () => {
      const user = await addUser("ann", "AGENT");
      const laptop = await service.login("staff", { username: user.username, password: PASSWORD }, client);
      await service.login("staff", { username: user.username, password: PASSWORD }, client);
      await service.logout(laptop.refreshToken);
      expect(repo.live(user.id)).toHaveLength(1);
      await service.logout("unknown-token-is-fine-xxxxxxxxxx");
      await service.logoutAll({ userId: user.id, role: "AGENT" });
      expect(repo.live(user.id)).toHaveLength(0);
    });

    it("needs the current password, signs out other devices and returns a new sign-in", async () => {
      const user = await addUser("ann", "AGENT");
      const other = await service.login("staff", { username: user.username, password: PASSWORD }, client);
      const auth = { userId: user.id, role: "AGENT" as const };

      await expect(
        service.changePassword(auth, { currentPassword: "wrong", newPassword: "brand-new-pass" }, client),
      ).rejects.toBeInstanceOf(ForbiddenError);

      const fresh = await service.changePassword(
        auth,
        { currentPassword: PASSWORD, newPassword: "brand-new-pass" },
        client,
      );
      await expect(service.refresh("staff", other.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
      await expect(service.refresh("staff", fresh.refreshToken, client)).resolves.toBeDefined();
      await expect(
        service.login("staff", { username: user.username, password: "brand-new-pass" }, client),
      ).resolves.toBeDefined();
    });

    it("counts wrong current passwords toward the sign-in lock", async () => {
      const user = await addUser("ann", "AGENT");
      const auth = { userId: user.id, role: "AGENT" as const };
      const attempt = (currentPassword: string) =>
        service.changePassword(auth, { currentPassword, newPassword: "brand-new-pass" }, client);

      for (let i = 0; i < 5; i++) await expect(attempt("wrong")).rejects.toBeInstanceOf(ForbiddenError);
      // Locked now: even the right password is refused, here and at sign-in.
      await expect(attempt(PASSWORD)).rejects.toBeInstanceOf(AccountLockedError);
      await expect(
        service.login("staff", { username: user.username, password: PASSWORD }, client),
      ).rejects.toBeInstanceOf(AccountLockedError);
      expect(await verifyPassword(PASSWORD, repo.users.get(user.id)?.passwordHash ?? "")).toBe(true);
    });
  });

  describe("sign-in lifetime", () => {
    it("keeps the sign-in's end when refreshing, so a sign-in never outlives REFRESH_TOKEN_TTL_DAYS", async () => {
      await addUser("ann", "AGENT");
      const first = await service.login("staff", { username: "ann", password: PASSWORD }, client);
      now = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
      const second = await service.refresh("staff", first.refreshToken, client);
      expect(second.refreshTokenExpiresAt).toBe(first.refreshTokenExpiresAt);
      now = new Date(first.refreshTokenExpiresAt);
      await expect(service.refresh("staff", second.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("deletes the user's expired sessions on a new sign-in, and only those", async () => {
      const ann = await addUser("ann", "AGENT");
      await addUser("bob", "AGENT");
      await service.login("staff", { username: ann.username, password: PASSWORD }, client);
      await service.login("staff", { username: "bob", password: PASSWORD }, client);
      now = new Date(now.getTime() + DEFAULT_AUTH_OPTIONS.refreshTtlMs + 1000);
      await service.login("staff", { username: ann.username, password: PASSWORD }, client);
      expect(repo.sessions.filter((s) => s.userId === ann.id)).toHaveLength(1);
      expect(repo.sessions).toHaveLength(2); // Bob's expired session stays until Bob signs in again.
    });

    it("gives customers and staff their own access-token lifetime", async () => {
      const perAudience = new AccessTokens("k".repeat(40), { staff: 900, customer: 3600 });
      expect(perAudience.ttlFor("AGENT")).toBe(900);
      expect(perAudience.ttlFor("ADMIN")).toBe(900);
      expect(perAudience.ttlFor("CUSTOMER")).toBe(3600);
      const issued = await perAudience.issue({ id: "8c4f1f7e-2d1a-4c56-9a3e-0f1b2c3d4e5f", role: "CUSTOMER" });
      expect(issued.expiresAt.getTime() - Date.now()).toBeGreaterThan(3500 * 1000);
    });
  });

  describe("session cleanup job", () => {
    it("deletes every user's expired sessions in batches and keeps the live and revoked-but-unexpired ones", async () => {
      const ann = await addUser("ann", "AGENT");
      const bob = await addUser("bob", "AGENT");
      for (let i = 0; i < 3; i++) await service.login("staff", { username: ann.username, password: PASSWORD }, client);
      await service.login("staff", { username: bob.username, password: PASSWORD }, client);
      now = new Date(now.getTime() + DEFAULT_AUTH_OPTIONS.refreshTtlMs / 2);
      const live = await service.login("staff", { username: bob.username, password: PASSWORD }, client);
      await service.logout(live.refreshToken); // revoked, not expired: kept for reuse detection
      now = new Date(now.getTime() + DEFAULT_AUTH_OPTIONS.refreshTtlMs / 2 + 1000);

      await expect(service.pruneExpiredSessions(2)).resolves.toEqual({ deletedSessions: 4 });
      expect(repo.sessions).toHaveLength(1);
      expect(repo.sessions[0]?.userId).toBe(bob.id);
      await expect(service.pruneExpiredSessions()).resolves.toEqual({ deletedSessions: 0 });
    });
  });

  describe("staff sign-in with LOS username and password", () => {
    const losIdentity = { losUserType: "STAFF", losUserId: 2, username: "admin", role: "AGENT" } as const;
    const withLos = (accessToken: string | null) =>
      new AuthService(
        repo.asRepository(),
        tokens,
        DEFAULT_AUTH_OPTIONS,
        () => now,
        undefined,
        { verifyStaffAccess: async () => losIdentity } as never,
        undefined,
        { accessToken: vi.fn(async () => accessToken) },
      );

    it("signs in the LOS account when LOS accepts the credentials", async () => {
      const result = await withLos("access").login("staff", { username: "admin", password: "los-pw" }, client);
      expect(result.user).toMatchObject({ username: null, losUserId: 2, role: "AGENT", displayName: "admin" });
    });

    it("falls back to the chat account's own password when LOS does not know the credentials", async () => {
      await addUser("ann", "AGENT");
      const result = await withLos(null).login("staff", { username: "ann", password: PASSWORD }, client);
      expect(result.user).toMatchObject({ username: "ann", losUserId: null });
      await expect(withLos(null).login("staff", { username: "ann", password: "nope" }, client)).rejects.toThrow(
        new UnauthorizedError("Invalid username or password"),
      );
    });

    it("signs in many LOS staff at once, one account each, and the same account again", async () => {
      const service = new AuthService(
        repo.asRepository(),
        tokens,
        DEFAULT_AUTH_OPTIONS,
        () => now,
        undefined,
        {
          verifyStaffAccess: async (token: string) => ({
            losUserType: "STAFF",
            losUserId: Number(token),
            username: `staff${token}`,
            role: Number(token) % 2 ? "AGENT" : "SUPERVISOR",
          }),
        } as never,
        undefined,
        { accessToken: async (username: string) => username.replace("staff", "") },
      );
      const ids = Array.from({ length: 30 }, (_, i) => i + 1);
      const first = await Promise.all(
        ids.map((id) => service.login("staff", { username: `staff${id}`, password: "los-pw" }, client)),
      );
      expect(new Set(first.map((r) => r.user.id)).size).toBe(30);
      expect(first[0]!.user.role).toBe("AGENT");
      expect(first[1]!.user.role).toBe("SUPERVISOR");
      const again = await Promise.all(
        ids.map((id) => service.login("staff", { username: `staff${id}`, password: "los-pw" }, client)),
      );
      expect(again.map((r) => r.user.id)).toEqual(first.map((r) => r.user.id));
      expect(repo.users.size).toBe(30);
    });

    it("does not ask LOS for customer sign-in", async () => {
      await addUser("cus", "CUSTOMER");
      const los = { accessToken: vi.fn(async () => "access") };
      const service = new AuthService(
        repo.asRepository(),
        tokens,
        DEFAULT_AUTH_OPTIONS,
        () => now,
        undefined,
        null,
        undefined,
        los,
      );
      await service.login("customer", { username: "cus", password: PASSWORD }, client);
      expect(los.accessToken).not.toHaveBeenCalled();
    });
  });

  describe("development sign-in, the LOS way (AUTH_MODE=dev)", () => {
    const staff = (userId: number, role: "AGENT" | "SUPERVISOR" | "ADMIN", username = "Sophea") =>
      ({ type: "staff", userId, username, role }) as const;

    it("creates an LOS-only staff account on first use and signs into the same one after", async () => {
      const first = await service.devLogin(staff(7, "AGENT"), client);
      expect(first.user).toMatchObject({ username: null, losUserId: 7, role: "AGENT", displayName: "Sophea" });
      expect(first.user.staff).not.toBeNull();
      await expect(tokens.verifyToken(first.accessToken)).resolves.toEqual({ userId: first.user.id, role: "AGENT" });
      const again = await service.devLogin(staff(7, "AGENT"), client);
      expect(again.user.id).toBe(first.user.id);
      expect(repo.users.size).toBe(1);
    });

    it("numbers customers and staff separately, as LOS does", async () => {
      const agent = await service.devLogin(staff(2, "AGENT"), client);
      const customer = await service.devLogin({ type: "customer", userId: 2, username: "Dara" }, client);
      expect(customer.user).toMatchObject({ losUserId: 2, role: "CUSTOMER", displayName: "Dara" });
      expect(customer.user.customer).not.toBeNull();
      expect(customer.user.id).not.toBe(agent.user.id);
    });

    it("follows the role and name it is given, signing out other devices on a role change, like LOS", async () => {
      const first = await service.devLogin(staff(9, "AGENT"), client);
      const promoted = await service.devLogin(staff(9, "SUPERVISOR", "Sophea Chan"), client);
      expect(promoted.user).toMatchObject({ id: first.user.id, role: "SUPERVISOR", displayName: "Sophea Chan" });
      expect(repo.sessions.find((s) => s.tokenHash === hashRefreshToken(first.refreshToken))?.revokedAt).not.toBeNull();
    });

    it("is the same account a real LOS token for that user would reach", async () => {
      const dev = await service.devLogin({ type: "customer", userId: 4, username: "Dara" }, client);
      const los = new AuthService(repo.asRepository(), tokens, DEFAULT_AUTH_OPTIONS, () => now, undefined, {
        verifyCustomer: async () => ({ losUserType: "CUSTOMER", losUserId: 4, username: "Dara", role: "CUSTOMER" }),
      } as unknown as LosTokenVerifier);
      expect((await los.losSignIn("customer", "an-los-token", client)).user.id).toBe(dev.user.id);
    });

    it("refuses an account an admin disabled", async () => {
      const { user } = await service.devLogin(staff(3, "ADMIN"), client);
      await repo.updateUser(user.id, { status: "DISABLED" });
      await expect(service.devLogin(staff(3, "ADMIN"), client)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("sign in with LOS", () => {
    const los = {
      verifyCustomer: vi.fn<(t: string) => Promise<LosIdentity>>(),
      verifyStaffHandoff: vi.fn<(t: string) => Promise<LosIdentity>>(),
    };
    const customer: LosIdentity = { losUserType: "CUSTOMER", losUserId: 2, username: "Dara", role: "CUSTOMER" };
    const agent: LosIdentity = { losUserType: "STAFF", losUserId: 7, username: "Sophea", role: "AGENT" };
    const identities = { sync: vi.fn(async () => {}) };

    beforeEach(() => {
      los.verifyCustomer.mockReset().mockResolvedValue(customer);
      los.verifyStaffHandoff.mockReset().mockResolvedValue(agent);
      identities.sync.mockClear();
      service = new AuthService(
        repo.asRepository(),
        tokens,
        DEFAULT_AUTH_OPTIONS,
        () => now,
        identities,
        los as unknown as LosTokenVerifier,
      );
    });

    it("creates an LOS-only account on the first sign-in and reuses it after", async () => {
      const first = await service.losSignIn("customer", "los-token", client);
      expect(los.verifyCustomer).toHaveBeenCalledWith("los-token");
      expect(first.user).toMatchObject({ username: null, losUserId: 2, displayName: "Dara", role: "CUSTOMER" });
      expect(identities.sync).toHaveBeenCalledWith({
        id: first.user.id,
        role: "CUSTOMER",
        displayName: "Dara",
        losUserId: 2,
      });
      await expect(tokens.verifyToken(first.accessToken)).resolves.toEqual({ userId: first.user.id, role: "CUSTOMER" });

      const second = await service.losSignIn("customer", "los-token", client);
      expect(second.user.id).toBe(first.user.id);
      expect(repo.users.size).toBe(1);
    });

    it("keeps customers and staff with the same LOS number apart", async () => {
      const a = await service.losSignIn("customer", "t", client);
      los.verifyStaffHandoff.mockResolvedValue({ ...agent, losUserId: 2 });
      const b = await service.losSignIn("staff", "t", client);
      expect(a.user.id).not.toBe(b.user.id);
      expect(b.user.role).toBe("AGENT");
    });

    it("follows the LOS name and role, and signs other devices out when the role changes", async () => {
      const first = await service.losSignIn("staff", "t", client);
      await service.losSignIn("staff", "t", client);
      expect(repo.live(first.user.id)).toHaveLength(2);

      los.verifyStaffHandoff.mockResolvedValue({ ...agent, username: "Sophea P.", role: "SUPERVISOR" });
      const promoted = await service.losSignIn("staff", "t", client);
      expect(promoted.user).toMatchObject({ id: first.user.id, role: "SUPERVISOR", displayName: "Sophea P." });
      expect(repo.live(first.user.id)).toHaveLength(1);
    });

    it("ends an LOS staff session at the staff limit so the dashboard needs a fresh hand-off; customers keep theirs", async () => {
      const limited = new AuthService(
        repo.asRepository(),
        tokens,
        { ...DEFAULT_AUTH_OPTIONS, losStaffSessionMs: 3_600_000 },
        () => now,
        identities,
        los as unknown as LosTokenVerifier,
      );
      const staff = await limited.losSignIn("staff", "t", client);
      expect(new Date(staff.refreshTokenExpiresAt).getTime()).toBe(now.getTime() + 3_600_000);

      // Refreshing keeps the end fixed; after it the refresh token is refused.
      const refreshed = await limited.refresh("staff", staff.refreshToken, client);
      expect(refreshed.refreshTokenExpiresAt).toBe(staff.refreshTokenExpiresAt);
      now = new Date(now.getTime() + 3_600_001);
      await expect(limited.refresh("staff", refreshed.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);

      const customerSession = await limited.losSignIn("customer", "t", client);
      expect(new Date(customerSession.refreshTokenExpiresAt).getTime()).toBe(
        now.getTime() + DEFAULT_AUTH_OPTIONS.refreshTtlMs,
      );
    });

    describe("the customer's LOS application", () => {
      const applications = { refreshFromCustomerToken: vi.fn(async () => {}) };
      beforeEach(() => {
        applications.refreshFromCustomerToken.mockClear();
        service = new AuthService(
          repo.asRepository(),
          tokens,
          DEFAULT_AUTH_OPTIONS,
          () => now,
          identities,
          los as unknown as LosTokenVerifier,
          applications,
        );
      });

      it("is read with the customer's own LOS token when a customer signs in, for the account that signed in", async () => {
        const result = await service.losSignIn("customer", "los-customer-token", client);
        expect(applications.refreshFromCustomerToken).toHaveBeenCalledWith(result.user.id, "los-customer-token");
      });

      it("is not read for staff, whose hand-off token is not a customer token", async () => {
        await service.losSignIn("staff", "handoff-token", client);
        expect(applications.refreshFromCustomerToken).not.toHaveBeenCalled();
      });

      it("never fails or delays the sign-in", async () => {
        applications.refreshFromCustomerToken.mockRejectedValue(new Error("boom"));
        await expect(service.losSignIn("customer", "t", client)).resolves.toMatchObject({ user: { role: "CUSTOMER" } });
        applications.refreshFromCustomerToken.mockReturnValue(new Promise(() => {}));
        await expect(service.losSignIn("customer", "t", client)).resolves.toBeDefined();
      });
    });

    it("refuses a disabled account even with a valid LOS token", async () => {
      const { user } = await service.losSignIn("customer", "t", client);
      await repo.updateUser(user.id, { status: "DISABLED" });
      await expect(service.losSignIn("customer", "t", client)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("passes the verifier's 401 through and creates nothing", async () => {
      los.verifyCustomer.mockRejectedValue(new UnauthorizedError("Invalid LOS token"));
      await expect(service.losSignIn("customer", "t", client)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(repo.users.size).toBe(0);
    });

    it("finds the account a parallel first sign-in created", async () => {
      const created = await repo.createLosUser({
        losUserType: "CUSTOMER",
        losUserId: 2,
        role: "CUSTOMER",
        displayName: "Dara",
      });
      const findUserByLos = vi.spyOn(repo, "findUserByLos").mockResolvedValueOnce(null);
      const result = await service.losSignIn("customer", "t", client);
      expect(result.user.id).toBe(created.id);
      findUserByLos.mockRestore();
    });

    it("answers 503 when LOS is not configured", async () => {
      service = new AuthService(repo.asRepository(), tokens, DEFAULT_AUTH_OPTIONS, () => now);
      await expect(service.losSignIn("customer", "t", client)).rejects.toMatchObject({
        status: 503,
        code: "LOS_SIGN_IN_DISABLED",
      });
      await expect(service.losSignIn("customer", "t", client)).rejects.toBeInstanceOf(AppError);
    });

    it("has no password to sign in with or to change", async () => {
      const { user, accessToken } = await service.losSignIn("customer", "t", client);
      const auth = await tokens.verifyToken(accessToken);
      await expect(
        service.changePassword(auth, { currentPassword: "x", newPassword: "long-enough-1" }, client),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(repo.users.get(user.id)?.passwordHash).toBeNull();
    });
  });
});
