import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { createEscalationBody, escalationParams, updateEscalationBody } from "./escalation.schema.js";
import type { EscalationService } from "./escalation.service.js";

export class EscalationController {
  constructor(private readonly service: EscalationService) {}

  list = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.list(getAuth(req), parsed(req, "params", idParams).id) });
  };

  create = async (req: Request, res: Response) => {
    const data = await this.service.escalate(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", createEscalationBody),
    );
    res.status(201).json({ status: "success", data });
  };

  close = async (req: Request, res: Response) => {
    const { escalationId } = parsed(req, "params", escalationParams);
    res.json({
      status: "success",
      data: await this.service.close(getAuth(req), escalationId, parsed(req, "body", updateEscalationBody)),
    });
  };
}
