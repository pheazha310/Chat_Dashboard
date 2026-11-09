import type { AuthContext } from "@shared/auth/auth.types.js";
import { ADMIN_LOCKED_PERMISSIONS, can } from "@shared/auth/permissions.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { RoleRepository } from "./role.repository.js";
import type { SetRolePermissionsInput } from "./role.schema.js";
import type { PermissionDto, RoleDto } from "./role.types.js";

type RoleRow = NonNullable<Awaited<ReturnType<RoleRepository["findRole"]>>>;

const nameOf = (p: { module: string; action: string }) => `${p.module}.${p.action}`;

const toRole = (row: RoleRow): RoleDto => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  description: row.description,
  permissions: row.rolePermissions.map(({ permission }) => nameOf(permission)).sort(),
});

/**
 * What each role may do. Role names are fixed (access tokens carry them); their permissions are data. A change applies
 * to signed-in users within `IDENTITY_CACHE_MS` (60 s), when their identity is next loaded.
 */
export class RoleService {
  constructor(private readonly repository: RoleRepository) {}

  async list(auth: AuthContext): Promise<RoleDto[]> {
    requireRead(auth);
    return (await this.repository.listRoles()).map(toRole);
  }

  async permissions(auth: AuthContext): Promise<PermissionDto[]> {
    requireRead(auth);
    return (await this.repository.listPermissions()).map((p) => ({
      name: nameOf(p),
      module: p.module,
      action: p.action,
      description: p.description,
    }));
  }

  /**
   * Replaces the role's permissions. Customer roles get none (every permission is a staff one), and ADMIN always keeps
   * `users.manage` and `roles.manage`, so nobody can lock everyone out of account and role management.
   */
  async setPermissions(auth: AuthContext, roleId: number, input: SetRolePermissionsInput): Promise<RoleDto> {
    if (!can(auth, "roles.manage")) throw new ForbiddenError("You are not allowed to change role permissions");
    const wanted = new Set(input.permissions);
    return this.repository.inTransaction(async (tx) => {
      const role = await tx.findRole(roleId);
      if (!role) throw new NotFoundError("Role not found");
      if (role.kind === "CUSTOMER" && wanted.size > 0) {
        throw new BadRequestError("Customer roles cannot have staff permissions");
      }
      const missing = role.name === "ADMIN" ? ADMIN_LOCKED_PERMISSIONS.filter((p) => !wanted.has(p)) : [];
      if (missing.length > 0) {
        throw new BadRequestError(`ADMIN must keep ${missing.join(" and ")}`, { required: missing });
      }
      const catalogue = await tx.listPermissions();
      const ids = catalogue.filter((p) => wanted.has(nameOf(p))).map((p) => p.id);
      if (ids.length !== wanted.size) {
        // The code knows a permission the database does not: a migration is missing.
        throw new Error("The permission catalogue in the database is out of date; run the migrations");
      }
      await tx.replaceGrants(role.id, ids);
      return toRole((await tx.findRole(role.id)) as RoleRow);
    });
  }
}

function requireRead(auth: AuthContext) {
  if (!can(auth, "roles.read")) throw new ForbiddenError("You are not allowed to view roles");
}
