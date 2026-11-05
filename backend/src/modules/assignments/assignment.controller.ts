import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { assignBody, transferBody, unassignBody } from "./assignment.schema.js";
import type { AssignmentService } from "./assignment.service.js";

export class AssignmentController {
  constructor(private readonly service: AssignmentService) {}

  assign = async (req: Request, res: Response) => {
    const data = await this.service.assign(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", assignBody),
    );
    res.json({ status: "success", data });
  };

  transfer = async (req: Request, res: Response) => {
    const data = await this.service.transfer(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", transferBody),
    );
    res.json({ status: "success", data });
  };

  unassign = async (req: Request, res: Response) => {
    const data = await this.service.unassign(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", unassignBody),
    );
    res.json({ status: "success", data });
  };

  history = async (req: Request, res: Response) => {
    const data = await this.service.history(getAuth(req), parsed(req, "params", idParams).id);
    res.json({ status: "success", data });
  };
}
