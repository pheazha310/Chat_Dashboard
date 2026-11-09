import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import {
  callbackParams,
  completeCallbackBody,
  createCallbackBody,
  listCallbacksQuery,
  updateCallbackBody,
} from "./callback.schema.js";
import type { CallbackService } from "./callback.service.js";

export class CallbackController {
  constructor(private readonly service: CallbackService) {}

  list = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.list(getAuth(req), parsed(req, "query", listCallbacksQuery));
    res.json({ status: "success", data: items, meta });
  };

  listForConversation = async (req: Request, res: Response) => {
    const data = await this.service.listForConversation(getAuth(req), parsed(req, "params", idParams).id);
    res.json({ status: "success", data });
  };

  create = async (req: Request, res: Response) => {
    const data = await this.service.create(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", createCallbackBody),
    );
    res.status(201).json({ status: "success", data });
  };

  get = async (req: Request, res: Response) => {
    const { callbackId } = parsed(req, "params", callbackParams);
    res.json({ status: "success", data: await this.service.get(getAuth(req), callbackId) });
  };

  update = async (req: Request, res: Response) => {
    const { callbackId } = parsed(req, "params", callbackParams);
    const data = await this.service.update(getAuth(req), callbackId, parsed(req, "body", updateCallbackBody));
    res.json({ status: "success", data });
  };

  complete = async (req: Request, res: Response) => {
    const { callbackId } = parsed(req, "params", callbackParams);
    const data = await this.service.complete(getAuth(req), callbackId, parsed(req, "body", completeCallbackBody));
    res.json({ status: "success", data });
  };

  cancel = async (req: Request, res: Response) => {
    const { callbackId } = parsed(req, "params", callbackParams);
    res.json({ status: "success", data: await this.service.cancel(getAuth(req), callbackId) });
  };
}
