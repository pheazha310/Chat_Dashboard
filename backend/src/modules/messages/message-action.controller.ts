import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import {
  editBody,
  forwardBody,
  messageIdParams,
  reactionBody,
  reactionParams,
  replyBody,
} from "./message-action.schema.js";
import type { MessageActionService } from "./message-action.service.js";

export class MessageActionController {
  constructor(private readonly service: MessageActionService) {}

  reply = async (req: Request, res: Response) => {
    const { messageId } = parsed(req, "params", messageIdParams);
    const { message, created } = await this.service.reply(getAuth(req), messageId, parsed(req, "body", replyBody));
    res.status(created ? 201 : 200).json({ status: "success", data: message });
  };

  edit = async (req: Request, res: Response) => {
    const { messageId } = parsed(req, "params", messageIdParams);
    res.json({
      status: "success",
      data: await this.service.edit(getAuth(req), messageId, parsed(req, "body", editBody)),
    });
  };

  remove = async (req: Request, res: Response) => {
    const { messageId } = parsed(req, "params", messageIdParams);
    res.json({ status: "success", data: await this.service.remove(getAuth(req), messageId) });
  };

  history = async (req: Request, res: Response) => {
    const { messageId } = parsed(req, "params", messageIdParams);
    res.json({ status: "success", data: await this.service.history(getAuth(req), messageId) });
  };

  react = async (req: Request, res: Response) => {
    const { messageId } = parsed(req, "params", messageIdParams);
    const data = await this.service.react(getAuth(req), messageId, parsed(req, "body", reactionBody));
    res.json({ status: "success", data });
  };

  unreact = async (req: Request, res: Response) => {
    const { messageId, reactionId } = parsed(req, "params", reactionParams);
    res.json({ status: "success", data: await this.service.unreact(getAuth(req), messageId, reactionId) });
  };

  forward = async (req: Request, res: Response) => {
    const { messageId } = parsed(req, "params", messageIdParams);
    const { message, created } = await this.service.forward(getAuth(req), messageId, parsed(req, "body", forwardBody));
    res.status(created ? 201 : 200).json({ status: "success", data: message });
  };
}
