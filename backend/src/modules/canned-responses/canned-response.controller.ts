import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { createBody, listQuery, templateParams, updateBody } from "./canned-response.schema.js";
import type { CannedResponseService } from "./canned-response.service.js";

export class CannedResponseController {
  constructor(private readonly service: CannedResponseService) {}

  list = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.list(getAuth(req), parsed(req, "query", listQuery));
    res.json({ status: "success", data: items, meta });
  };

  get = async (req: Request, res: Response) => {
    const { templateId } = parsed(req, "params", templateParams);
    res.json({ status: "success", data: await this.service.get(getAuth(req), templateId) });
  };

  create = async (req: Request, res: Response) => {
    const data = await this.service.create(getAuth(req), parsed(req, "body", createBody));
    res.status(201).json({ status: "success", data });
  };

  update = async (req: Request, res: Response) => {
    const { templateId } = parsed(req, "params", templateParams);
    res.json({
      status: "success",
      data: await this.service.update(getAuth(req), templateId, parsed(req, "body", updateBody)),
    });
  };

  deactivate = async (req: Request, res: Response) => {
    const { templateId } = parsed(req, "params", templateParams);
    res.json({ status: "success", data: await this.service.deactivate(getAuth(req), templateId) });
  };
}
