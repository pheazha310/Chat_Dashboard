import { prisma, runInTransaction, type Db } from "@config/database.js";

const roleSelect = {
  id: true,
  name: true,
  kind: true,
  description: true,
  rolePermissions: { select: { permission: { select: { module: true, action: true } } } },
} as const;

/** `roles`, `permissions` and `role_permissions`. */
export class RoleRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: RoleRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new RoleRepository(tx)));
  }

  listRoles() {
    return this.db.role.findMany({ select: roleSelect, orderBy: { id: "asc" } });
  }

  findRole(id: number) {
    return this.db.role.findUnique({ where: { id }, select: roleSelect });
  }

  listPermissions() {
    return this.db.permission.findMany({
      select: { id: true, module: true, action: true, description: true },
      orderBy: [{ module: "asc" }, { action: "asc" }],
    });
  }

  /** Replaces the role's grants with `permissionIds`. Run inside `inTransaction`. */
  async replaceGrants(roleId: number, permissionIds: number[]): Promise<void> {
    await this.db.rolePermission.deleteMany({ where: { roleId } });
    if (permissionIds.length > 0) {
      await this.db.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      });
    }
  }
}
