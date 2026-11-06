import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { conversationParams, draftBody, preferencesBody } from "./workspace.schema.js";
import type { WorkspaceService } from "./workspace.service.js";

export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}

  get = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.get(getAuth(req)) });
  };

  updatePreferences = async (req: Request, res: Response) => {
    const data = await this.service.updatePreferences(getAuth(req), parsed(req, "body", preferencesBody));
    res.json({ status: "success", data });
  };

  openTab = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationParams);
    res.json({ status: "success", data: await this.service.openTab(getAuth(req), conversationId) });
  };

  closeTab = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationParams);
    res.json({ status: "success", data: await this.service.closeTab(getAuth(req), conversationId) });
  };

  saveDraft = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationParams);
    const data = await this.service.saveDraft(getAuth(req), conversationId, parsed(req, "body", draftBody));
    res.json({ status: "success", data });
  };

  clearDraft = async (req: Request, res: Response) => {
    const { conversationId } = parsed(req, "params", conversationParams);
    res.json({ status: "success", data: await this.service.clearDraft(getAuth(req), conversationId) });
  };
}
