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

  const addUser = async (email: string, role: string, status = "ACTIVE") =>
    repo
      .createUser({ email, passwordHash: await hashPassword(PASSWORD), role, displayName: email })
      .then(async (u) => (await repo.updateUser(u.id, { status })) as typeof u);

  beforeEach(() => {
    repo = new FakeAuthRepository();
    now = new Date("2026-11-07T10:00:00Z");
    service = new AuthService(repo.asRepository(), tokens, DEFAULT_AUTH_OPTIONS, () => now);
  });

  describe("login", () => {
    it("returns tokens for the right password and resets the failure count", async () => {
      const user = await addUser("ann@example.com", "AGENT");
      user.failedLoginCount = 3;
      const result = await service.login("staff", { email: "ann@example.com", password: PASSWORD }, client);

      expect(result.tokenType).toBe("Bearer");
      expect(result.user).toMatchObject({ id: user.id, email: "ann@example.com", role: "AGENT" });
      expect(result.user).not.toHaveProperty("passwordHash");
      await expect(tokens.verifyToken(result.accessToken)).resolves.toEqual({ userId: user.id, role: "AGENT" });
      expect(repo.users.get(user.id)?.failedLoginCount).toBe(0);
      // Only the hash of the refresh token is stored.
      expect(repo.sessions).toHaveLength(1);
      expect(repo.sessions[0]?.tokenHash).toBe(hashRefreshToken(result.refreshToken));
      expect(repo.sessions[0]).toMatchObject({ userAgent: "vitest", ipAddress: "127.0.0.1" });
    });

    it("answers an unknown email and a wrong password the same way", async () => {
      await addUser("ann@example.com", "AGENT");
      await expect(service.login("staff", { email: "bob@example.com", password: PASSWORD }, client)).rejects.toThrow(
        new UnauthorizedError("Invalid email or password"),
      );
      await expect(service.login("staff", { email: "ann@example.com", password: "nope" }, client)).rejects.toThrow(
        new UnauthorizedError("Invalid email or password"),
      );
      expect(repo.sessions).toHaveLength(0);
    });

    it("locks the account after 5 wrong passwords, even for the right one, until the lock ends", async () => {
      const user = await addUser("ann@example.com", "AGENT");
      for (let i = 0; i < 5; i++) {
        await expect(service.login("staff", { email: user.email, password: "wrong" }, client)).rejects.toThrow();
      }
      const locked = service.login("staff", { email: user.email, password: PASSWORD }, client);
      await expect(locked).rejects.toBeInstanceOf(AccountLockedError);
      await expect(locked).rejects.toMatchObject({ status: 429, details: { retryAfterSeconds: 900 } });

      now = new Date(now.getTime() + 15 * 60_000 + 1);
      await expect(service.login("staff", { email: user.email, password: PASSWORD }, client)).resolves.toBeDefined();
    });

    it("refuses a customer at the staff endpoint and staff at the customer endpoint, like a wrong password", async () => {
      await addUser("cus@example.com", "CUSTOMER");
      await addUser("agent@example.com", "AGENT");
      await expect(
        service.login("staff", { email: "cus@example.com", password: PASSWORD }, client),
      ).rejects.toBeInstanceOf(UnauthorizedError);
      await expect(
        service.login("customer", { email: "agent@example.com", password: PASSWORD }, client),
      ).rejects.toBeInstanceOf(UnauthorizedError);
      await expect(
        service.login("customer", { email: "cus@example.com", password: PASSWORD }, client),
      ).resolves.toBeDefined();
    });

    it("refuses a disabled account once the password is right", async () => {
      await addUser("ann@example.com", "AGENT", "DISABLED");
      await expect(
        service.login("staff", { email: "ann@example.com", password: PASSWORD }, client),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("upgrades a hash made with old parameters", async () => {
      const user = await addUser("ann@example.com", "AGENT");
      // A valid hash with a lower cost (log2 N = 14) than the current one.
      const { scryptSync, randomBytes } = await import("node:crypto");
      const salt = randomBytes(16);
      const key = scryptSync(PASSWORD, salt, 64, { N: 2 ** 14, r: 8, p: 1 });
      user.passwordHash = `scrypt$14$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
      await service.login("staff", { email: user.email, password: PASSWORD }, client);
      expect(repo.users.get(user.id)?.passwordHash).toMatch(/^scrypt\$15\$/);
    });
  });

  describe("register", () => {
    it("creates a customer and signs them in; a taken email is 409", async () => {
      const result = await service.register(
        { email: "new@example.com", password: "long-enough", displayName: "New" },
        client,
      );
      expect(result.user).toMatchObject({ role: "CUSTOMER", email: "new@example.com", status: "ACTIVE" });
      await expect(
        service.register({ email: "new@example.com", password: "long-enough", displayName: "Again" }, client),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("chat identity", () => {
    it("copies the name and role on registration and on every sign-in, and survives a failed copy", async () => {
      const identities = { sync: vi.fn(async () => {}) };
      service = new AuthService(repo.asRepository(), tokens, DEFAULT_AUTH_OPTIONS, () => now, identities);
      const registered = await service.register(
        { email: "dara@example.com", password: "long-enough", displayName: "Dara" },
        client,
      );
      expect(identities.sync).toHaveBeenCalledWith({
        id: registered.user.id,
        role: "CUSTOMER",
        displayName: "Dara",
        losUserId: null,
      });

      const user = await addUser("ann@example.com", "AGENT");
      identities.sync.mockRejectedValueOnce(new Error("db hiccup"));
      await expect(service.login("staff", { email: user.email, password: PASSWORD }, client)).resolves.toBeDefined();
      expect(identities.sync).toHaveBeenLastCalledWith({
        id: user.id,
        role: "AGENT",
        displayName: user.email,
        losUserId: null,
      });
    });
  });

  describe("refresh", () => {
    it("rotates: the old refresh token stops working and the new one works", async () => {
      await addUser("ann@example.com", "AGENT");
      const first = await service.login("staff", { email: "ann@example.com", password: PASSWORD }, client);
      const second = await service.refresh("staff", first.refreshToken, client);
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(repo.live()).toHaveLength(1);
      await expect(service.refresh("staff", second.refreshToken, client)).resolves.toBeDefined();
    });

    it("links each rotated session to the one that replaced it", async () => {
      await addUser("ann@example.com", "AGENT");
      const first = await service.login("staff", { email: "ann@example.com", password: PASSWORD }, client);
      await service.refresh("staff", first.refreshToken, client);
      const [old, current] = repo.sessions;
      expect(old?.replacedById).toBe(current?.id);
      expect(current?.replacedById).toBeNull();
      expect(current?.familyId).toBe(old?.familyId);
    });

    it("revokes the whole sign-in when a used refresh token comes back", async () => {
      await addUser("ann@example.com", "AGENT");
      const first = await service.login("staff", { email: "ann@example.com", password: PASSWORD }, client);
      const second = await service.refresh("staff", first.refreshToken, client);

      await expect(service.refresh("staff", first.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
      await expect(service.refresh("staff", second.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(repo.live()).toHaveLength(0);
    });

    it("treats losing a rotation race as reuse and keeps the revocation", async () => {
      await addUser("ann@example.com", "AGENT");
      const first = await service.login("staff", { email: "ann@example.com", password: PASSWORD }, client);
      repo.loseNextRotation = true;
      await expect(service.refresh("staff", first.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(repo.live()).toHaveLength(0);
    });

    it("refuses unknown and expired tokens, disabled users and the wrong endpoint", async () => {
      const user = await addUser("ann@example.com", "AGENT");
      await expect(service.refresh("staff", "x".repeat(43), client)).rejects.toBeInstanceOf(UnauthorizedError);

      const a = await service.login("staff", { email: user.email, password: PASSWORD }, client);
      await expect(service.refresh("customer", a.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);

      const b = await service.login("staff", { email: user.email, password: PASSWORD }, client);
      user.status = "DISABLED";
      await expect(service.refresh("staff", b.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
      user.status = "ACTIVE";

      const c = await service.login("staff", { email: user.email, password: PASSWORD }, client);
      now = new Date(now.getTime() + DEFAULT_AUTH_OPTIONS.refreshTtlMs);
      await expect(service.refresh("staff", c.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  describe("logout and password change", () => {
    it("logout revokes that sign-in only; logoutAll revokes every one", async () => {
      const user = await addUser("ann@example.com", "AGENT");
      const laptop = await service.login("staff", { email: user.email, password: PASSWORD }, client);
      await service.login("staff", { email: user.email, password: PASSWORD }, client);
      await service.logout(laptop.refreshToken);
      expect(repo.live(user.id)).toHaveLength(1);
      await service.logout("unknown-token-is-fine-xxxxxxxxxx");
      await service.logoutAll({ userId: user.id, role: "AGENT" });
      expect(repo.live(user.id)).toHaveLength(0);
    });

    it("needs the current password, signs out other devices and returns a new sign-in", async () => {
      const user = await addUser("ann@example.com", "AGENT");
      const other = await service.login("staff", { email: user.email, password: PASSWORD }, client);
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
        service.login("staff", { email: user.email, password: "brand-new-pass" }, client),
      ).resolves.toBeDefined();
    });

    it("counts wrong current passwords toward the sign-in lock", async () => {
      const user = await addUser("ann@example.com", "AGENT");
      const auth = { userId: user.id, role: "AGENT" as const };
      const attempt = (currentPassword: string) =>
        service.changePassword(auth, { currentPassword, newPassword: "brand-new-pass" }, client);

      for (let i = 0; i < 5; i++) await expect(attempt("wrong")).rejects.toBeInstanceOf(ForbiddenError);
      // Locked now: even the right password is refused, here and at sign-in.
      await expect(attempt(PASSWORD)).rejects.toBeInstanceOf(AccountLockedError);
      await expect(service.login("staff", { email: user.email, password: PASSWORD }, client)).rejects.toBeInstanceOf(
        AccountLockedError,
      );
      expect(await verifyPassword(PASSWORD, repo.users.get(user.id)?.passwordHash ?? "")).toBe(true);
    });
  });

  describe("sign-in lifetime", () => {
    it("keeps the sign-in's end when refreshing, so a sign-in never outlives REFRESH_TOKEN_TTL_DAYS", async () => {
      await addUser("ann@example.com", "AGENT");
      const first = await service.login("staff", { email: "ann@example.com", password: PASSWORD }, client);
      now = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
      const second = await service.refresh("staff", first.refreshToken, client);
      expect(second.refreshTokenExpiresAt).toBe(first.refreshTokenExpiresAt);
      now = new Date(first.refreshTokenExpiresAt);
      await expect(service.refresh("staff", second.refreshToken, client)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("deletes the user's expired sessions on a new sign-in, and only those", async () => {
      const ann = await addUser("ann@example.com", "AGENT");
      await addUser("bob@example.com", "AGENT");
      await service.login("staff", { email: ann.email, password: PASSWORD }, client);
      await service.login("staff", { email: "bob@example.com", password: PASSWORD }, client);
      now = new Date(now.getTime() + DEFAULT_AUTH_OPTIONS.refreshTtlMs + 1000);
      await service.login("staff", { email: ann.email, password: PASSWORD }, client);
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
      const ann = await addUser("ann@example.com", "AGENT");
      const bob = await addUser("bob@example.com", "AGENT");
      for (let i = 0; i < 3; i++) await service.login("staff", { email: ann.email, password: PASSWORD }, client);
      await service.login("staff", { email: bob.email, password: PASSWORD }, client);
      now = new Date(now.getTime() + DEFAULT_AUTH_OPTIONS.refreshTtlMs / 2);
      const live = await service.login("staff", { email: bob.email, password: PASSWORD }, client);
      await service.logout(live.refreshToken); // revoked, not expired: kept for reuse detection
      now = new Date(now.getTime() + DEFAULT_AUTH_OPTIONS.refreshTtlMs / 2 + 1000);

      await expect(service.pruneExpiredSessions(2)).resolves.toEqual({ deletedSessions: 4 });
      expect(repo.sessions).toHaveLength(1);
      expect(repo.sessions[0]?.userId).toBe(bob.id);
      await expect(service.pruneExpiredSessions()).resolves.toEqual({ deletedSessions: 0 });
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
      expect(first.user).toMatchObject({ email: null, losUserId: 2, displayName: "Dara", role: "CUSTOMER" });
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
