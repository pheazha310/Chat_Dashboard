import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ForbiddenError, UnauthorizedError } from "@shared/errors/AppError.js";
import { hashPassword, verifyPassword } from "../auth.password.js";
import { AccountLockedError, AuthService } from "../auth.service.js";
import { AccessTokens, hashRefreshToken } from "../auth.tokens.js";
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
      .then((u) => repo.updateUser(u.id, { status }));

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
      expect(identities.sync).toHaveBeenCalledWith({ id: registered.user.id, role: "CUSTOMER", displayName: "Dara" });

      const user = await addUser("ann@example.com", "AGENT");
      identities.sync.mockRejectedValueOnce(new Error("db hiccup"));
      await expect(service.login("staff", { email: user.email, password: PASSWORD }, client)).resolves.toBeDefined();
      expect(identities.sync).toHaveBeenLastCalledWith({ id: user.id, role: "AGENT", displayName: user.email });
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
      expect(await verifyPassword(PASSWORD, repo.users.get(user.id)!.passwordHash)).toBe(true);
    });
  });
});
