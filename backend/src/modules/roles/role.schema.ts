import { z } from "zod";
import { PERMISSION_NAMES } from "@shared/auth/permissions.js";

export const roleParams = z.object({ roleId: z.coerce.number().int().positive() });

/** The complete new set of permissions for the role (replaces the old one). Unknown names are a 400. */
export const setRolePermissionsBody = z
  .object({ permissions: z.array(z.enum(PERMISSION_NAMES as [string, ...string[]])).max(200) })
  .strict();
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsBody>;
