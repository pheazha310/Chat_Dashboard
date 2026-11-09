/** A role with the permissions it currently has (`module.action` names, sorted). */
export interface RoleDto {
  id: number;
  name: string;
  kind: string;
  description: string | null;
  permissions: string[];
}

/** One entry of the permission catalogue. */
export interface PermissionDto {
  name: string;
  module: string;
  action: string;
  description: string | null;
}
