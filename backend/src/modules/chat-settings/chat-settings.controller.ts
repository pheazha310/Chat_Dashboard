import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { chatSettingsBody } from "./chat-settings.schema.js";
import type { ChatSettingsService } from "./chat-settings.service.js";

export class ChatSettingsController {
  constructor(private readonly service: ChatSettingsService) {}

  get = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.get(getAuth(req)) });
  };

  update = async (req: Request, res: Response) => {
    res.json({
      status: "success",
      data: await this.service.update(getAuth(req), parsed(req, "body", chatSettingsBody)),
    });
  };
}
