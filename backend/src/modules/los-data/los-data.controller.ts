import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import type { LoanApplicationService } from "./los-data.service.js";

export class LoanApplicationController {
  constructor(private readonly service: LoanApplicationService) {}

  application = async (req: Request, res: Response) => {
    res.json({
      status: "success",
      data: await this.service.forConversation(getAuth(req), parsed(req, "params", idParams).id),
    });
  };
}
