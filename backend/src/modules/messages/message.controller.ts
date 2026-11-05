import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { cursorQuery } from "@shared/utils/pagination.js";
import { messageParams, readBody, sendBody } from "./message.schema.js";
import type { MessageService } from "./message.service.js";

export class MessageController {
  constructor(private readonly service: MessageService) {}

  send = async (req: Request, res: Response) => {
    const { message, created } = await this.service.send(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", sendBody),
    );
    res.status(created ? 201 : 200).json({ status: "success", data: message });
  };

  history = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.history(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "query", cursorQuery),
    );
    res.json({ status: "success", data: items, meta });
  };

  markRead = async (req: Request, res: Response) => {
    const data = await this.service.markRead(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", readBody).messageId,
    );
    res.json({ status: "success", data });
  };

  markUnread = async (req: Request, res: Response) => {
    const data = await this.service.markUnread(getAuth(req), parsed(req, "params", idParams).id);
    res.json({ status: "success", data });
  };

  markDelivered = async (req: Request, res: Response) => {
    const { id, messageId } = parsed(req, "params", messageParams);
    const data = await this.service.markDelivered(getAuth(req), id, messageId);
    res.json({ status: "success", data });
  };
}
