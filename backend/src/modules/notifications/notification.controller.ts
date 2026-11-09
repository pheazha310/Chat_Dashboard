import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { listQuery, muteBody, preferencesBody } from "./notification.schema.js";
import type { NotificationService } from "./notification.service.js";

export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  list = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.list(getAuth(req), parsed(req, "query", listQuery));
    res.json({ status: "success", data: items, meta });
  };

  unreadCount = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.unreadCount(getAuth(req)) });
  };

  markRead = async (req: Request, res: Response) => {
    const data = await this.service.markRead(getAuth(req), parsed(req, "params", idParams).id);
    res.json({ status: "success", data });
  };

  markAllRead = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.markAllRead(getAuth(req)) });
  };

  mute = async (req: Request, res: Response) => {
    const data = await this.service.setMuted(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", muteBody).muted,
    );
    res.json({ status: "success", data });
  };

  getPreferences = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.getPreferences(getAuth(req)) });
  };

  updatePreferences = async (req: Request, res: Response) => {
    const data = await this.service.updatePreferences(getAuth(req), parsed(req, "body", preferencesBody));
    res.json({ status: "success", data });
  };
}
