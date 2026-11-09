import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import { uid } from "../../../__tests__/support/ids.js";
import { verifyPassword } from "../auth.password.js";
import { UserDirectory, UserService, type AccountStatusListener } from "../user.service.js";
import { FakeAuthRepository } from "./fake-auth-repository.js";

const staff = { email: "new@example.com", displayName: "New Agent", role: "AGENT" as const, password: "initial-pass" };

describe("UserService", () => {
  let repo: FakeAuthRepository;
  let status: { setStatus: Mock<AccountStatusListener["setStatus"]>; sync: Mock<AccountStatusListener["sync"]> };
  let service: UserService;
  let admin: AuthContext;

  beforeEach(async () => {
    repo = new FakeAuthRepository();
    status = {
      setStatus: vi.fn<AccountStatusListener["setStatus"]>().mockResolvedValue(undefined),
      sync: vi.fn<AccountStatusListener["sync"]>().mockResolvedValue(undefined),
    };
    service = new UserService(repo.asRepository(), status);
    const created = await service.bootstrapAdmin({
      email: "root@example.com",
      displayName: "Root",
      password: "x".repeat(8),
    });
    admin = { userId: created.id, role: "ADMIN" };
  });

  it("creates an account of any role from the command line, and refuses a taken email", async () => {
    const customer = {
      email: "c@example.com",
      displayName: "Cust",
      password: "x".repeat(8),
      role: "CUSTOMER" as const,
    };
    const user = await service.bootstrapAccount(customer);
    expect(user).toMatchObject({ email: "c@example.com", role: "CUSTOMER", status: "ACTIVE" });
    expect(repo.users.get(user.id)).toMatchObject({ createdBy: null });
    expect(status.sync).toHaveBeenCalledWith({ id: user.id, role: "CUSTOMER", displayName: "Cust" });
    await expect(service.bootstrapAccount(customer)).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets only admins create staff, and refuses a taken email", async () => {
    await expect(service.create({ userId: uid(1), role: "SUPERVISOR" }, staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.create({ userId: uid(1), role: "AGENT" }, staff)).rejects.toBeInstanceOf(ForbiddenError);
    const user = await service.create(admin, staff);
    expect(user).toMatchObject({ email: "new@example.com", role: "AGENT", status: "ACTIVE" });
    expect(repo.users.get(user.id)).toMatchObject({ createdBy: admin.userId });
    await expect(service.create(admin, staff)).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets supervisors read accounts but not agents", async () => {
    await expect(service.list({ userId: uid(1), role: "AGENT" }, { page: 1, size: 25 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const page = await service.list({ userId: uid(1), role: "SUPERVISOR" }, { page: 1, size: 25 });
    expect(page.meta.total).toBe(1);
    expect(page.items[0]).not.toHaveProperty("passwordHash");
    await expect(service.get({ userId: uid(1), role: "SUPERVISOR" }, uid(99))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("disabling signs the user out everywhere and tells the identity mapping; re-enabling clears a lock", async () => {
    const user = await service.create(admin, staff);
    await repo.createSession({
      userId: user.id,
      familyId: uid(5),
      tokenHash: "h1",
      expiresAt: new Date(Date.now() + 1e6),
      userAgent: null,
      ipAddress: null,
    });

    await service.update(admin, user.id, { status: "DISABLED" });
    expect(repo.live(user.id)).toHaveLength(0);
    expect(status.setStatus).toHaveBeenCalledWith({ id: user.id, role: "AGENT" }, "DISABLED");

    repo.users.get(user.id)!.lockedUntil = new Date(Date.now() + 1e6);
    await service.update(admin, user.id, { status: "ACTIVE" });
    expect(repo.users.get(user.id)?.lockedUntil).toBeNull();
    expect(status.setStatus).toHaveBeenLastCalledWith({ id: user.id, role: "AGENT" }, "ACTIVE");
  });

  it("copies name and role to the chat identity on creation, rename and role change, not on a status change", async () => {
    const user = await service.create(admin, staff);
    expect(status.sync).toHaveBeenLastCalledWith({ id: user.id, role: "AGENT", displayName: "New Agent" });
    status.sync.mockClear();
    await service.update(admin, user.id, { status: "DISABLED" });
    expect(status.sync).not.toHaveBeenCalled();
    await service.update(admin, user.id, { role: "SUPERVISOR", displayName: "Lead" });
    expect(status.sync).toHaveBeenCalledWith({ id: user.id, role: "SUPERVISOR", displayName: "Lead" });
  });

  it("keeps a status change when mirroring it to the chat identity fails", async () => {
    const user = await service.create(admin, staff);
    status.setStatus.mockRejectedValueOnce(new Error("db hiccup"));
    await expect(service.update(admin, user.id, { status: "DISABLED" })).resolves.toMatchObject({ status: "DISABLED" });
    expect(repo.users.get(user.id)?.status).toBe("DISABLED");
    await expect(service.account(user.id)).resolves.toEqual({ role: "AGENT", status: "DISABLED" });
    await expect(service.account(uid(99))).resolves.toBeNull();
  });

  it("a role change signs the user out; a name change does not", async () => {
    const user = await service.create(admin, staff);
    const session = {
      userId: user.id,
      familyId: uid(5),
      expiresAt: new Date(Date.now() + 1e6),
      userAgent: null,
      ipAddress: null,
    };
    await repo.createSession({ ...session, tokenHash: "h1" });
    await service.update(admin, user.id, { displayName: "Renamed" });
    expect(repo.live(user.id)).toHaveLength(1);
    await service.update(admin, user.id, { role: "SUPERVISOR" });
    expect(repo.live(user.id)).toHaveLength(0);
    expect(status.setStatus).not.toHaveBeenCalled();
  });

  it("refuses an admin changing their own role or status, and a customer becoming staff", async () => {
    await expect(service.update(admin, admin.userId, { role: "AGENT" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.update(admin, admin.userId, { status: "DISABLED" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.update(admin, admin.userId, { displayName: "Me" })).resolves.toMatchObject({
      displayName: "Me",
    });

    const customer = await repo.createUser({
      email: "c@example.com",
      passwordHash: "x",
      role: "CUSTOMER",
      displayName: "C",
    });
    await expect(service.update(admin, customer.id, { role: "AGENT" })).rejects.toBeInstanceOf(BadRequestError);
    await expect(service.update(admin, customer.id, { status: "DISABLED" })).resolves.toMatchObject({
      status: "DISABLED",
    });
  });

  it("refuses to give an LOS-only account a password (it has no email to sign in with)", async () => {
    const los = await repo.createLosUser({ losUserType: "STAFF", losUserId: 7, role: "AGENT", displayName: "Sophea" });
    await expect(service.resetPassword(admin, los.id, "another-pass")).rejects.toBeInstanceOf(ConflictError);
    expect(repo.users.get(los.id)?.passwordHash).toBeNull();
  });

  it("refuses a new role for an LOS account (LOS sets it at every sign-in), but allows a rename or disabling", async () => {
    const los = await repo.createLosUser({ losUserType: "STAFF", losUserId: 8, role: "AGENT", displayName: "Dara" });
    await expect(service.update(admin, los.id, { role: "SUPERVISOR" })).rejects.toBeInstanceOf(ConflictError);
    expect(repo.users.get(los.id)?.role).toBe("AGENT");
    await expect(service.update(admin, los.id, { role: "AGENT", displayName: "Dara K" })).resolves.toMatchObject({
      displayName: "Dara K",
    });
    await expect(service.update(admin, los.id, { status: "DISABLED" })).resolves.toMatchObject({ status: "DISABLED" });
  });

  it("resets a password: the new one works and every session ends", async () => {
    const user = await service.create(admin, staff);
    await repo.createSession({
      userId: user.id,
      familyId: uid(5),
      tokenHash: "h1",
      expiresAt: new Date(Date.now() + 1e6),
      userAgent: null,
      ipAddress: null,
    });
    await expect(
      service.resetPassword({ userId: uid(1), role: "SUPERVISOR" }, user.id, "another-pass"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await service.resetPassword(admin, user.id, "another-pass");
    await expect(verifyPassword("another-pass", repo.users.get(user.id)?.passwordHash ?? "")).resolves.toBe(true);
    expect(repo.live(user.id)).toHaveLength(0);
  });

  it("serves names to the directory: staff as agents, customers as customers", async () => {
    const agent = await service.create(admin, staff);
    const customer = await repo.createUser({
      email: "c@example.com",
      passwordHash: "x",
      role: "CUSTOMER",
      displayName: "Cee",
    });
    const directory = new UserDirectory(service);
    await expect(directory.getAgents([agent.id, customer.id, agent.id])).resolves.toEqual([
      { id: agent.id, name: "New Agent", avatarUrl: null },
    ]);
    await expect(directory.getCustomer(customer.id)).resolves.toMatchObject({
      id: customer.id,
      name: "Cee",
      email: "c@example.com",
    });
    await expect(directory.getCustomer(agent.id)).resolves.toBeNull();
  });
});
