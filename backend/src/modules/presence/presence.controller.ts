import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { setPresenceBody } from "./presence.schema.js";
import type { PresenceService } from "./presence.service.js";

export class PresenceController {
  constructor(private readonly service: PresenceService) {}

  list = async (_req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.snapshot() });
  };

  setMine = async (req: Request, res: Response) => {
    const data = await this.service.setStatus(getAuth(req), parsed(req, "body", setPresenceBody));
    res.json({ status: "success", data });
  };
}
