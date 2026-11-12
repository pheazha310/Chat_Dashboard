import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { cursorQuery } from "@shared/utils/pagination.js";
import { sendFileResponse } from "@modules/attachments/index.js";
import { voiceFields } from "@modules/attachments/attachment.schema.js";
import type { CustomerChannelService } from "./customer-channel.service.js";
import {
  attachmentParams,
  chatSendBody,
  mineHistoryQuery,
  callParams,
  conversationParams,
  downloadQuery,
  fileFields,
  joinBody,
  messageAudioParams,
  sendBody,
  startCallBody,
} from "./customer-channel.schema.js";

/** The verified customer id (the token's `userId`). */
const customerOf = (req: Request) => getAuth(req).userId;

export class CustomerChannelController {
  constructor(private readonly service: CustomerChannelService) {}

  startCall = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationParams);
    const call = await this.service.startCall(customerOf(req), conversationId, parsed(req, "body", startCallBody));
    res.status(201).json({ status: "success", data: call });
  };

  /** accept, decline, cancel or end a call: the action is the last path segment. */
  callAction =
    (action: "acceptCall" | "declineCall" | "cancelCall" | "endCall") => async (req: Request, res: Response) => {
      const { callId } = parsed(req, "params", callParams);
      res.json({ status: "success", data: await this.service[action](customerOf(req), callId) });
    };

  join = async (req: Request, res: Response) => {
    const { conversation, created } = await this.service.join(customerOf(req), parsed(req, "body", joinBody));
    res.status(created ? 201 : 200).json({ status: "success", data: conversation });
  };

  mine = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.mine(customerOf(req)) });
  };

  historyOfMine = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.historyOfMine(customerOf(req), parsed(req, "query", mineHistoryQuery));
    res.json({ status: "success", data: items, meta });
  };

  sendToMine = async (req: Request, res: Response) => {
    const { message, created } = await this.service.sendToMine(customerOf(req), parsed(req, "body", chatSendBody));
    res.status(created ? 201 : 200).json({ status: "success", data: message });
  };

  uploadToMine = async (req: Request, res: Response) => {
    res.status(201).json({ status: "success", data: await this.service.uploadToMine(customerOf(req), req.file) });
  };

  conversation = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationParams);
    res.json({ status: "success", data: await this.service.conversation(customerOf(req), conversationId) });
  };

  history = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationParams);
    const { items, meta } = await this.service.history(
      customerOf(req),
      conversationId,
      parsed(req, "query", cursorQuery),
    );
    res.json({ status: "success", data: items, meta });
  };

  sendText = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationParams);
    const { message, created } = await this.service.sendText(
      customerOf(req),
      conversationId,
      parsed(req, "body", sendBody),
    );
    res.status(created ? 201 : 200).json({ status: "success", data: message });
  };

  sendFile = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationParams);
    const { message, created } = await this.service.sendFile(
      customerOf(req),
      conversationId,
      parsed(req, "body", fileFields),
      req.file,
    );
    res.status(created ? 201 : 200).json({ status: "success", data: message });
  };

  sendVoice = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationParams);
    const { message, created } = await this.service.sendVoice(
      customerOf(req),
      conversationId,
      parsed(req, "body", voiceFields),
      req.file,
    );
    res.status(created ? 201 : 200).json({ status: "success", data: message });
  };

  download = async (req: Request, res: Response) => {
    const { attachmentId } = parsed(req, "params", attachmentParams);
    const { inline } = parsed(req, "query", downloadQuery);
    await sendFileResponse(req, res, () =>
      this.service.download(customerOf(req), attachmentId, { range: req.headers.range, inline }),
    );
  };

  audio = async (req: Request, res: Response) => {
    const { messageId } = parsed(req, "params", messageAudioParams);
    await sendFileResponse(req, res, () =>
      this.service.audio(customerOf(req), messageId, { range: req.headers.range }),
    );
  };
}
