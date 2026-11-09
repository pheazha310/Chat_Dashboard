import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { roleParams, setRolePermissionsBody } from "./role.schema.js";
import type { RoleService } from "./role.service.js";

export class RoleController {
  constructor(private readonly service: RoleService) {}

  list = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.list(getAuth(req)) });
  };

  permissions = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.permissions(getAuth(req)) });
  };

  setPermissions = async (req: Request, res: Response) => {
    const { roleId } = parsed(req, "params", roleParams);
    const input = parsed(req, "body", setRolePermissionsBody);
    res.json({ status: "success", data: await this.service.setPermissions(getAuth(req), roleId, input) });
  };
}
