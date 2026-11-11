import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { approvalBody, autoResponsesBody, exampleParams, trainingExampleBody } from "./automation.schema.js";
import type { AutomationService } from "./automation.service.js";

export class AutomationController {
  constructor(private readonly service: AutomationService) {}

  getAutoResponses = async (_req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.getAutoResponses() });
  };

  saveAutoResponses = async (req: Request, res: Response) => {
    res.json({
      status: "success",
      data: await this.service.saveAutoResponses(getAuth(req), parsed(req, "body", autoResponsesBody)),
    });
  };

  listExamples = async (_req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.listExamples() });
  };

  addExample = async (req: Request, res: Response) => {
    const data = await this.service.addExample(getAuth(req), parsed(req, "body", trainingExampleBody));
    res.status(201).json({ status: "success", data });
  };

  setApproval = async (req: Request, res: Response) => {
    const { exampleId } = parsed(req, "params", exampleParams);
    const { approved } = parsed(req, "body", approvalBody);
    res.json({ status: "success", data: await this.service.setApproval(getAuth(req), exampleId, approved) });
  };
}
