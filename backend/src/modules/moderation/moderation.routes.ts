import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { container } from "../../app-container.js";
import { ModerationController } from "./moderation.controller.js";
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

const controller = new ModerationController(container.moderation);

/** Mounted at /api/v1/admin/conversations (authentication is applied at the mount). */
export const conversationModerationRoutes = Router();

conversationModerationRoutes.post(
  "/:id/customer-block",
  validate({ params: idParams, body: blockBody }),
  controller.blockFromConversation,
);
conversationModerationRoutes.get(
  "/:id/spam-reports",
  validate({ params: idParams, query: pageQuery }),
  controller.listConversationReports,
);
conversationModerationRoutes.post(
  "/:id/spam-reports",
  validate({ params: idParams, body: reportSpamBody }),
  controller.report,
);

/** Mounted at /api/v1/admin/moderation. */
export const moderationRoutes = Router();

moderationRoutes.get("/blocks", validate({ query: listBlocksQuery }), controller.listBlocks);
moderationRoutes.post(
  "/customers/:customerId/block",
  validate({ params: customerParams, body: blockBody }),
  controller.blockCustomer,
);
moderationRoutes.delete("/customers/:customerId/block", validate({ params: customerParams }), controller.unblock);

moderationRoutes.get("/keywords", validate({ query: listKeywordsQuery }), controller.listKeywords);
moderationRoutes.post("/keywords", validate({ body: createKeywordBody }), controller.createKeyword);
moderationRoutes.patch(
  "/keywords/:keywordId",
  validate({ params: keywordParams, body: updateKeywordBody }),
  controller.updateKeyword,
);
moderationRoutes.delete("/keywords/:keywordId", validate({ params: keywordParams }), controller.deleteKeyword);

moderationRoutes.get("/spam-reports", validate({ query: listReportsQuery }), controller.listReports);
moderationRoutes.patch(
  "/spam-reports/:reportId",
  validate({ params: reportParams, body: reviewReportBody }),
  controller.review,
);

moderationRoutes.get("/activities", validate({ query: listActivitiesQuery }), controller.listActivities);
