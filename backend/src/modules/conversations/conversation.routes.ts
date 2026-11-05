import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { messageService } from "@modules/messages/index.js";
import { ConversationController } from "./conversation.controller.js";
import { ConversationRepository } from "./conversation.repository.js";
import { createBody, listQuery, statusBody } from "./conversation.schema.js";
import { ConversationService } from "./conversation.service.js";

const controller = new ConversationController(new ConversationService(new ConversationRepository(), messageService));

export const conversationRoutes = Router();

conversationRoutes.get("/", validate({ query: listQuery }), controller.list);
conversationRoutes.post("/", validate({ body: createBody }), controller.create);
conversationRoutes.get("/:id", validate({ params: idParams }), controller.get);
conversationRoutes.get("/:id/activities", validate({ params: idParams, query: pageQuery }), controller.activities);
conversationRoutes.patch("/:id/status", validate({ params: idParams, body: statusBody }), controller.changeStatus);
conversationRoutes.post("/:id/archive", validate({ params: idParams }), controller.archive);
conversationRoutes.post("/:id/restore", validate({ params: idParams }), controller.restore);
