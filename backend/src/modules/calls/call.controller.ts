import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { callParams, listCallsQuery, startCallBody } from "./call.schema.js";
import type { CallService } from "./call.service.js";

export class CallController {
  constructor(private readonly service: CallService) {}

  config = (req: Request, res: Response) => {
    // Contains per-user TURN credentials: never cache it.
    res.set("Cache-Control", "no-store");
    res.json({ status: "success", data: this.service.iceServers(getAuth(req)) });
  };

  listForConversation = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.listForConversation(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "query", listCallsQuery),
    );
    res.json({ status: "success", data: items, meta });
  };

  start = async (req: Request, res: Response) => {
    const data = await this.service.start(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", startCallBody),
    );
    res.status(201).json({ status: "success", data });
  };

  get = async (req: Request, res: Response) => {
    const { callId } = parsed(req, "params", callParams);
    res.json({ status: "success", data: await this.service.get(getAuth(req), callId) });
  };

  accept = async (req: Request, res: Response) => this.act(req, res, (auth, id) => this.service.accept(auth, id));
  decline = async (req: Request, res: Response) => this.act(req, res, (auth, id) => this.service.decline(auth, id));
  cancel = async (req: Request, res: Response) => this.act(req, res, (auth, id) => this.service.cancel(auth, id));
  end = async (req: Request, res: Response) => this.act(req, res, (auth, id) => this.service.end(auth, id));

  private async act(
    req: Request,
    res: Response,
    action: (auth: ReturnType<typeof getAuth>, callId: string) => Promise<unknown>,
  ) {
    const { callId } = parsed(req, "params", callParams);
    res.json({ status: "success", data: await action(getAuth(req), callId) });
  }
}
