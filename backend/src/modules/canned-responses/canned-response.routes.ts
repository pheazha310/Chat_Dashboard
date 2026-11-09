import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { container } from "../../app-container.js";
import { CannedResponseController } from "./canned-response.controller.js";
import { createBody, listQuery, templateParams, updateBody } from "./canned-response.schema.js";

const controller = new CannedResponseController(container.cannedResponses);

/** Mounted at /api/v1/admin/canned-responses (authentication is applied at the mount). */
export const cannedResponseRoutes = Router();

cannedResponseRoutes.get("/", validate({ query: listQuery }), controller.list);
cannedResponseRoutes.post("/", validate({ body: createBody }), controller.create);
cannedResponseRoutes.get("/:templateId", validate({ params: templateParams }), controller.get);
cannedResponseRoutes.patch("/:templateId", validate({ params: templateParams, body: updateBody }), controller.update);
cannedResponseRoutes.delete("/:templateId", validate({ params: templateParams }), controller.deactivate);
