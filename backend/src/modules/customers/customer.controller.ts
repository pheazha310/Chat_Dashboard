import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import type { CustomerService } from "./customer.service.js";

export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  customer = async (req: Request, res: Response) => {
    res.json({
      status: "success",
      data: await this.service.customer(getAuth(req), parsed(req, "params", idParams).id),
    });
  };

  otherConversations = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.otherConversations(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "query", pageQuery),
    );
    res.json({ status: "success", data: items, meta });
  };

  participants = async (req: Request, res: Response) => {
    res.json({
      status: "success",
      data: await this.service.participants(getAuth(req), parsed(req, "params", idParams).id),
    });
  };
}
