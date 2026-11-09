import { beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { PERMISSION_NAMES } from "@shared/auth/permissions.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { RoleRepository } from "../role.repository.js";
import { RoleService } from "../role.service.js";

/** In-memory roles and grants with the repository's shape. */
function fakeRepository() {
  const catalogue = PERMISSION_NAMES.map((name, i) => {
    const [module, action] = name.split(".") as [string, string];
    return { id: i + 1, module, action, description: null };
  });
  const roles = [
    { id: 1, name: "CUSTOMER", kind: "CUSTOMER", description: null },
    { id: 2, name: "AGENT", kind: "STAFF", description: null },
    { id: 3, name: "SUPERVISOR", kind: "STAFF", description: null },
    { id: 4, name: "ADMIN", kind: "STAFF", description: null },
  ];
  const grants = new Map<number, number[]>([[4, catalogue.map((p) => p.id)]]);
  const withPermissions = (role: (typeof roles)[number]) => ({
    ...role,
    rolePermissions: (grants.get(role.id) ?? []).map((id) => ({ permission: catalogue[id - 1]! })),
  });
  const repo = {
    grants,
    inTransaction: async <T>(fn: (r: RoleRepository) => Promise<T>) => fn(repo as unknown as RoleRepository),
    listRoles: async () => roles.map(withPermissions),
    findRole: async (id: number) => {
      const role = roles.find((r) => r.id === id);
      return role ? withPermissions(role) : null;
    },
    listPermissions: async () => catalogue,
    replaceGrants: async (roleId: number, ids: number[]) => void grants.set(roleId, ids),
  };
  return repo;
}

const admin: AuthContext = { userId: uid(1), role: "ADMIN" };
const supervisor: AuthContext = { userId: uid(2), role: "SUPERVISOR" };
const agent: AuthContext = { userId: uid(3), role: "AGENT" };

describe("RoleService", () => {
  let repo: ReturnType<typeof fakeRepository>;
  let service: RoleService;

  beforeEach(() => {
    repo = fakeRepository();
    service = new RoleService(repo as unknown as RoleRepository);
  });

  it("lets supervisors and admins read roles and the catalogue, not agents", async () => {
    await expect(service.list(agent)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.permissions(agent)).rejects.toBeInstanceOf(ForbiddenError);
    const roles = await service.list(supervisor);
    expect(roles.map((r) => r.name)).toEqual(["CUSTOMER", "AGENT", "SUPERVISOR", "ADMIN"]);
    expect(roles[3]?.permissions).toHaveLength(PERMISSION_NAMES.length);
    expect((await service.permissions(admin))[0]?.name).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it("replaces a role's permissions (admins only)", async () => {
    await expect(service.setPermissions(supervisor, 2, { permissions: ["tags.delete"] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const updated = await service.setPermissions(admin, 2, {
      permissions: ["tags.delete", "conversations.view_all", "tags.delete"],
    });
    expect(updated.permissions).toEqual(["conversations.view_all", "tags.delete"]);
    expect(await service.setPermissions(admin, 2, { permissions: [] })).toMatchObject({ permissions: [] });
  });

  it("keeps ADMIN able to manage accounts and roles, gives customers nothing, and 404s an unknown role", async () => {
    await expect(service.setPermissions(admin, 4, { permissions: ["users.manage"] })).rejects.toMatchObject({
      status: 400,
      message: "ADMIN must keep roles.manage",
    });
    await expect(service.setPermissions(admin, 1, { permissions: ["tags.delete"] })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    await expect(service.setPermissions(admin, 99, { permissions: [] })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.grants.get(4)).toHaveLength(PERMISSION_NAMES.length);
  });
});
