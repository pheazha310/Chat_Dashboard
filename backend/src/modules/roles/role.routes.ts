import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { roleService } from "../../app-container.js";
import { RoleController } from "./role.controller.js";
import { roleParams, setRolePermissionsBody } from "./role.schema.js";

const controller = new RoleController(roleService);

/** Mounted at /api/v1/admin/roles (authentication is applied at the mount; the service checks the permission). */
export const roleRoutes = Router();

roleRoutes.get("/", controller.list);
roleRoutes.put(
  "/:roleId/permissions",
  validate({ params: roleParams, body: setRolePermissionsBody }),
  controller.setPermissions,
);

/** Mounted at /api/v1/admin/permissions: the catalogue. */
export const permissionRoutes = Router();

permissionRoutes.get("/", controller.permissions);
