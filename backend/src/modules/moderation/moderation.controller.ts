import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import {
  blockBody,
  createKeywordBody,
  customerParams,
  keywordParams,
  listActivitiesQuery,
  listBlocksQuery,
  listKeywordsQuery,
  listReportsQuery,
  reportParams,
  reportSpamBody,
  reviewReportBody,
  updateKeywordBody,
} from "./moderation.schema.js";
import type { ModerationService } from "./moderation.service.js";

const paged = <T>(res: Response, result: { items: T[]; meta: unknown }) =>
  res.json({ status: "success", data: result.items, meta: result.meta });

export class ModerationController {
  constructor(private readonly service: ModerationService) {}

  blockFromConversation = async (req: Request, res: Response) => {
    const data = await this.service.blockFromConversation(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", blockBody),
    );
    res.status(201).json({ status: "success", data });
  };

  blockCustomer = async (req: Request, res: Response) => {
    const { customerId } = parsed(req, "params", customerParams);
    const data = await this.service.blockCustomer(getAuth(req), customerId, parsed(req, "body", blockBody));
    res.status(201).json({ status: "success", data });
  };

  unblock = async (req: Request, res: Response) => {
    const { customerId } = parsed(req, "params", customerParams);
    res.json({ status: "success", data: await this.service.unblock(getAuth(req), customerId) });
  };

  listBlocks = async (req: Request, res: Response) =>
    paged(res, await this.service.listBlocks(getAuth(req), parsed(req, "query", listBlocksQuery)));

  listKeywords = async (req: Request, res: Response) =>
    paged(res, await this.service.listKeywords(parsed(req, "query", listKeywordsQuery)));

  createKeyword = async (req: Request, res: Response) => {
    const { keyword } = parsed(req, "body", createKeywordBody);
    res.status(201).json({ status: "success", data: await this.service.createKeyword(getAuth(req), keyword) });
  };

  updateKeyword = async (req: Request, res: Response) => {
    const { keywordId } = parsed(req, "params", keywordParams);
    const data = await this.service.updateKeyword(getAuth(req), keywordId, parsed(req, "body", updateKeywordBody));
    res.json({ status: "success", data });
  };

  deleteKeyword = async (req: Request, res: Response) => {
    const { keywordId } = parsed(req, "params", keywordParams);
    res.json({ status: "success", data: await this.service.deleteKeyword(getAuth(req), keywordId) });
  };

  report = async (req: Request, res: Response) => {
    const data = await this.service.report(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", reportSpamBody),
    );
    res.status(201).json({ status: "success", data });
  };

  listReports = async (req: Request, res: Response) =>
    paged(res, await this.service.listReports(getAuth(req), parsed(req, "query", listReportsQuery)));

  listConversationReports = async (req: Request, res: Response) =>
    paged(
      res,
      await this.service.listReportsForConversation(
        getAuth(req),
        parsed(req, "params", idParams).id,
        parsed(req, "query", pageQuery),
      ),
    );

  review = async (req: Request, res: Response) => {
    const { reportId } = parsed(req, "params", reportParams);
    const data = await this.service.review(getAuth(req), reportId, parsed(req, "body", reviewReportBody));
    res.json({ status: "success", data });
  };

  listActivities = async (req: Request, res: Response) =>
    paged(res, await this.service.listActivities(getAuth(req), parsed(req, "query", listActivitiesQuery)));
}
