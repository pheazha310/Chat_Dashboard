import { beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthAuditEvent } from "../auth.audit.js";
import { UserService } from "../user.service.js";
import { FakeAuthRepository } from "./fake-auth-repository.js";

/**
 * Seam B: the rules for linking an existing chat account to an LOS identity. Linking is explicit and admin-only; it is
 * never inferred from a name, email or phone.
 */
const staffLink = { provider: "LOS" as const, externalUserType: "STAFF" as const, externalUserId: 42 };

describe("identity linking", () => {
  let repo: FakeAuthRepository;
  let events: AuthAuditEvent[];
  let service: UserService;
  let admin: AuthContext;
  let annId: string;

  beforeEach(async () => {
    repo = new FakeAuthRepository();
    events = [];
    service = new UserService(
      repo.asRepository(),
      { setStatus: async () => {}, sync: async () => {} },
      { record: async (event) => void events.push(event) },
    );
    const root = await service.bootstrapAdmin({ username: "root", displayName: "Root", password: "x".repeat(8) });
    admin = { userId: root.id, role: "ADMIN" };
    annId = (
      await service.create(admin, { username: "ann", displayName: "Ann", role: "AGENT", password: "x".repeat(8) })
    ).id;
  });

  it("links an account to an LOS identity and records who did it", async () => {
    const linked = await service.linkIdentity(admin, annId, staffLink);
    expect(linked).toMatchObject({ id: annId, losUserId: 42, username: "ann" });
    expect(repo.identities).toMatchObject([
      { userId: annId, externalUserId: "42", externalUserType: "STAFF", linkedBy: admin.userId },
    ]);
    expect(events).toMatchObject([
      { event: "IDENTITY_LINKED", outcome: "SUCCESS", userId: annId, actorId: admin.userId },
    ]);
  });

  it("lets only admins link or unlink", async () => {
    for (const role of ["AGENT", "SUPERVISOR"] as const) {
      await expect(service.linkIdentity({ userId: uid(1), role }, annId, staffLink)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(service.unlinkIdentity({ userId: uid(1), role }, annId, "LOS")).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(repo.identities).toHaveLength(0);
  });

  it("refuses an identity that already belongs to another account, so a person never maps to two", async () => {
    const bob = await service.create(admin, {
      username: "bob",
      displayName: "Bob",
      role: "AGENT",
      password: "x".repeat(8),
    });
    await service.linkIdentity(admin, annId, staffLink);
    await expect(service.linkIdentity(admin, bob.id, staffLink)).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses to give an account a second LOS identity", async () => {
    await service.linkIdentity(admin, annId, staffLink);
    await expect(service.linkIdentity(admin, annId, { ...staffLink, externalUserId: 43 })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("refuses a customer identity for a staff account and the other way round", async () => {
    await expect(
      service.linkIdentity(admin, annId, { ...staffLink, externalUserType: "CUSTOMER" }),
    ).rejects.toBeInstanceOf(BadRequestError);
    const cat = await service.bootstrapAccount({
      username: "cat",
      displayName: "Cat",
      password: "x".repeat(8),
      role: "CUSTOMER",
    });
    await expect(service.linkIdentity(admin, cat.id, staffLink)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("answers 404 for an unknown account", async () => {
    await expect(service.linkIdentity(admin, uid(9), staffLink)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("unlinks, signs the account out everywhere and keeps its chat sign-in", async () => {
    await service.linkIdentity(admin, annId, staffLink);
    await repo.createSession({
      userId: annId,
      familyId: uid(5),
      tokenHash: "h".repeat(64),
      expiresAt: new Date(Date.now() + 1e6),
      userAgent: null,
      ipAddress: null,
    });
    const unlinked = await service.unlinkIdentity(admin, annId, "LOS");
    expect(unlinked).toMatchObject({ id: annId, losUserId: null, username: "ann" });
    expect(repo.identities).toHaveLength(0);
    expect(repo.live(annId)).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ event: "IDENTITY_UNLINKED", userId: annId, actorId: admin.userId });
  });

  it("refuses to unlink the only way an account can sign in", async () => {
    const losOnly = await repo.createLosUser({ losUserType: "STAFF", losUserId: 7, role: "AGENT", displayName: "L" });
    await expect(service.unlinkIdentity(admin, losOnly.id, "LOS")).rejects.toBeInstanceOf(ConflictError);
    expect(repo.identities).toHaveLength(1);
  });

  it("answers 404 when there is nothing to unlink", async () => {
    await expect(service.unlinkIdentity(admin, annId, "LOS")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records revoking sessions when an admin disables an account", async () => {
    await service.update(admin, annId, { status: "DISABLED" });
    expect(events).toMatchObject([
      { event: "SESSIONS_REVOKED", userId: annId, actorId: admin.userId, reason: "DISABLED" },
    ]);
  });

  describe("chat credentials for an account that signs in through LOS", () => {
    const losOnly = () => repo.createLosUser({ losUserType: "STAFF", losUserId: 7, role: "AGENT", displayName: "Lee" });

    it("gives the same account a username and password, so no second account is needed", async () => {
      const lee = await losOnly();
      const updated = await service.resetPassword(admin, lee.id, "a-new-password", "lee");
      expect(updated).toMatchObject({ id: lee.id, username: "lee", losUserId: 7 });
      expect(repo.users.size).toBe(3); // root, ann, lee
      expect(repo.users.get(lee.id)?.passwordHash).toMatch(/^scrypt\$/);
    });

    it("needs a username for such an account, and refuses one that is taken", async () => {
      const lee = await losOnly();
      await expect(service.resetPassword(admin, lee.id, "a-new-password")).rejects.toBeInstanceOf(ConflictError);
      await expect(service.resetPassword(admin, lee.id, "a-new-password", "ann")).rejects.toBeInstanceOf(ConflictError);
    });

    it("does not rename an account that already has a username", async () => {
      await expect(service.resetPassword(admin, annId, "a-new-password", "other")).rejects.toBeInstanceOf(
        BadRequestError,
      );
    });
  });
});
