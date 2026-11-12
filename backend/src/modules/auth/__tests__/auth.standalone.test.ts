import { beforeEach, describe, expect, it } from "vitest";
import { AppError, ForbiddenError, UnauthorizedError } from "@shared/errors/AppError.js";
import type { LosIdentity, LosTokenVerifier } from "../auth.los.js";
import type { AuthAuditEvent } from "../auth.audit.js";
import { hashPassword } from "../auth.password.js";
import { AuthService } from "../auth.service.js";
import { AccessTokens } from "../auth.tokens.js";
import { DEFAULT_AUTH_OPTIONS } from "../auth.types.js";
import { FakeAuthRepository } from "./fake-auth-repository.js";

/**
 * Seam A (standalone mode): AuthService with a fake database and a fake LOS. Chat must authenticate and keep sessions
 * alive on its own, resolve LOS and chat sign-ins to one account, and record who signed in or was refused.
 */
const tokens = new AccessTokens("k".repeat(40), 900);
const client = { userAgent: "vitest", ipAddress: "127.0.0.1" };
const PASSWORD = "agent-password-1";
const staffLos: LosIdentity = { losUserType: "STAFF", losUserId: 42, username: "ann.los", role: "AGENT" };

const losDown = () => {
  throw new AppError(503, "LOS_SIGN_IN_UNAVAILABLE", "Sign in with LOS is unavailable; try again later");
};

describe("standalone mode", () => {
  let repo: FakeAuthRepository;
  let events: AuthAuditEvent[];
  let losAvailable: boolean;
  let service: AuthService;

  const addStaff = async (username: string, role = "AGENT") =>
    repo.createUser({ username, passwordHash: await hashPassword(PASSWORD), role, displayName: username });

  beforeEach(() => {
    repo = new FakeAuthRepository();
    events = [];
    losAvailable = false;
    const los = {
      verifyStaffHandoff: async () => (losAvailable ? staffLos : losDown()),
      verifyStaffAccess: async () => (losAvailable ? staffLos : losDown()),
      verifyCustomer: async () =>
        losAvailable ? { ...staffLos, losUserType: "CUSTOMER", role: "CUSTOMER" } : losDown(),
    } as unknown as LosTokenVerifier;
    // LOS refuses chat-only accounts, as the real LOS does for an unknown username.
    const losLogin = { accessToken: async () => null };
    service = new AuthService(
      repo.asRepository(),
      tokens,
      DEFAULT_AUTH_OPTIONS,
      () => new Date("2026-11-12T10:00:00Z"),
      { sync: async () => {} },
      los,
      undefined,
      losLogin,
      { record: async (event) => void events.push(event) },
    );
  });

  describe("chat authentication without LOS", () => {
    it("signs a staff member in with a chat account while LOS is down", async () => {
      const ann = await addStaff("ann");
      const result = await service.login("staff", { username: "ann", password: PASSWORD }, client);
      expect(result.user.id).toBe(ann.id);
      await expect(tokens.verifyToken(result.accessToken)).resolves.toEqual({ userId: ann.id, role: "AGENT" });
    });

    it("never sends the password to LOS when the caller asks for chat authentication", async () => {
      let losAsked = false;
      const asked = {
        accessToken: async () => {
          losAsked = true;
          return null;
        },
      };
      const chatOnly = new AuthService(
        repo.asRepository(),
        tokens,
        DEFAULT_AUTH_OPTIONS,
        undefined,
        undefined,
        {} as LosTokenVerifier,
        undefined,
        asked,
      );
      await addStaff("ann");
      await chatOnly.login("staff", { username: "ann", password: PASSWORD, provider: "chat" }, client);
      expect(losAsked).toBe(false);
    });

    it("keeps an existing session working and refreshable while LOS is down", async () => {
      await addStaff("ann");
      const first = await service.login("staff", { username: "ann", password: PASSWORD }, client);
      const next = await service.refresh("staff", first.refreshToken, client);
      expect(next.refreshToken).not.toBe(first.refreshToken);
      await expect(tokens.verifyToken(next.accessToken)).resolves.toMatchObject({ role: "AGENT" });
    });
  });

  describe("refusals", () => {
    it("refuses an unknown username and a customer account on the staff endpoint", async () => {
      await repo.createUser({
        username: "cat",
        passwordHash: await hashPassword(PASSWORD),
        role: "CUSTOMER",
        displayName: "c",
      });
      await expect(service.login("staff", { username: "nobody", password: PASSWORD }, client)).rejects.toThrow(
        UnauthorizedError,
      );
      await expect(service.login("staff", { username: "cat", password: PASSWORD }, client)).rejects.toThrow(
        UnauthorizedError,
      );
      expect(repo.sessions).toHaveLength(0);
    });

    it("refuses a disabled account and does not start a session", async () => {
      const ann = await addStaff("ann");
      await repo.updateUser(ann.id, { status: "DISABLED" });
      await expect(service.login("staff", { username: "ann", password: PASSWORD }, client)).rejects.toThrow(
        ForbiddenError,
      );
      expect(repo.sessions).toHaveLength(0);
    });

    it("refuses refresh once the account is disabled, so a live session cannot outlast suspension", async () => {
      const ann = await addStaff("ann");
      const session = await service.login("staff", { username: "ann", password: PASSWORD }, client);
      await repo.updateUser(ann.id, { status: "DISABLED" });
      await expect(service.refresh("staff", session.refreshToken, client)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe("one person, one chat account", () => {
    it("signs an LOS identity into the chat account an admin linked it to, creating no second user", async () => {
      const ann = await addStaff("ann");
      await repo.linkIdentity(ann.id, { provider: "LOS", externalUserType: "STAFF", externalUserId: "42" }, null);
      losAvailable = true;
      const result = await service.losSignIn("staff", "handoff-token", client);
      expect(result.user.id).toBe(ann.id);
      expect(repo.users.size).toBe(1);
    });

    it("does not match an LOS identity to a chat account by name, email or anything but the link", async () => {
      await repo.createUser({
        username: "ann.los",
        email: "ann@example.test",
        passwordHash: await hashPassword(PASSWORD),
        role: "AGENT",
        displayName: "ann.los",
      });
      losAvailable = true;
      const result = await service.losSignIn("staff", "handoff-token", client);
      expect(repo.users.size).toBe(2);
      expect(result.user.username).toBeNull();
    });

    it("records the identity when LOS first signs someone in, and reuses it the next time", async () => {
      losAvailable = true;
      const first = await service.losSignIn("staff", "t", client);
      const second = await service.losSignIn("staff", "t", client);
      expect(second.user.id).toBe(first.user.id);
      expect(repo.users.size).toBe(1);
      expect(repo.identities).toHaveLength(1);
    });
  });

  describe("audit trail", () => {
    it("records a chat sign-in and a refused one, without the password", async () => {
      const ann = await addStaff("ann");
      await service.login("staff", { username: "ann", password: PASSWORD }, client);
      await expect(service.login("staff", { username: "ann", password: "wrong-password-1" }, client)).rejects.toThrow();
      expect(events).toMatchObject([
        { event: "LOGIN_SUCCESS", provider: "CHAT", outcome: "SUCCESS", userId: ann.id, ipAddress: "127.0.0.1" },
        { event: "LOGIN_FAILED", provider: "CHAT", outcome: "FAILURE", userId: ann.id, reason: "BAD_PASSWORD" },
      ]);
      expect(JSON.stringify(events)).not.toContain("wrong-password-1");
      expect(JSON.stringify(events)).not.toContain(PASSWORD);
    });

    it("records unknown usernames and disabled accounts, and a sign-in through LOS", async () => {
      const ann = await addStaff("ann");
      await repo.updateUser(ann.id, { status: "DISABLED" });
      await expect(service.login("staff", { username: "nobody", password: PASSWORD }, client)).rejects.toThrow();
      await expect(service.login("staff", { username: "ann", password: PASSWORD }, client)).rejects.toThrow();
      losAvailable = true;
      await service.losSignIn("staff", "t", client);
      expect(events.map((e) => [e.event, e.provider, e.reason ?? null])).toEqual([
        ["LOGIN_FAILED", "CHAT", "UNKNOWN_USER"],
        ["LOGIN_FAILED", "CHAT", "DISABLED"],
        ["LOGIN_SUCCESS", "LOS", null],
      ]);
    });

    it("records an LOS sign-in that LOS could not verify, telling an outage from a refusal", async () => {
      await expect(service.losSignIn("staff", "t", client)).rejects.toThrow(AppError);
      expect(events).toMatchObject([{ event: "LOGIN_FAILED", provider: "LOS", reason: "LOS_UNAVAILABLE" }]);
    });

    it("records logout and refusing a reused refresh token", async () => {
      await addStaff("ann");
      const session = await service.login("staff", { username: "ann", password: PASSWORD }, client);
      await service.logout(session.refreshToken);
      await expect(service.refresh("staff", session.refreshToken, client)).rejects.toThrow(UnauthorizedError);
      expect(events.map((e) => e.event)).toEqual(["LOGIN_SUCCESS", "LOGOUT", "REFRESH_REUSE_DETECTED"]);
    });

    it("does not store text that is not shaped like a username", async () => {
      await expect(
        service.login("staff", { username: "My Secret Pass!", password: PASSWORD }, client),
      ).rejects.toThrow();
      expect(events[0]?.attemptedUsername ?? null).toBeNull();
    });
  });
});
