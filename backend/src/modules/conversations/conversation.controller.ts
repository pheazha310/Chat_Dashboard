import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { createBody, listQuery, statusBody } from "./conversation.schema.js";
import type { ConversationService } from "./conversation.service.js";

export class ConversationController {
  constructor(private readonly service: ConversationService) {}

  list = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.list(getAuth(req), parsed(req, "query", listQuery));
    res.json({ status: "success", data: items, meta });
  };

  create = async (req: Request, res: Response) => {
    const { conversation, created } = await this.service.create(getAuth(req), parsed(req, "body", createBody));
    res.status(created ? 201 : 200).json({ status: "success", data: conversation });
  };

  get = async (req: Request, res: Response) => {
    const data = await this.service.get(getAuth(req), parsed(req, "params", idParams).id);
    res.json({ status: "success", data });
  };

  changeStatus = async (req: Request, res: Response) => {
    const { id } = parsed(req, "params", idParams);
    const data = await this.service.changeStatus(getAuth(req), id, parsed(req, "body", statusBody).status);
    res.json({ status: "success", data });
  };

  archive = async (req: Request, res: Response) => {
    const data = await this.service.archive(getAuth(req), parsed(req, "params", idParams).id);
    res.json({ status: "success", data });
  };

  restore = async (req: Request, res: Response) => {
    const data = await this.service.restore(getAuth(req), parsed(req, "params", idParams).id);
    res.json({ status: "success", data });
  };

  activities = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.activities(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "query", pageQuery),
    );
    res.json({ status: "success", data: items, meta });
  };
}
