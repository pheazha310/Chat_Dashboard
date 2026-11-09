import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { agentConversationsQuery } from "./profile.schema.js";
import type { ProfileService } from "./profile.service.js";

export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  agentMe = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.agentMe(getAuth(req)) });
  };

  agentConversations = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.agentConversations(
      getAuth(req),
      parsed(req, "query", agentConversationsQuery),
    );
    res.json({ status: "success", data: items, meta });
  };

  customerMe = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.customerMe(getAuth(req)) });
  };

  customerConversations = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.customerConversations(getAuth(req), parsed(req, "query", pageQuery));
    res.json({ status: "success", data: items, meta });
  };
}
