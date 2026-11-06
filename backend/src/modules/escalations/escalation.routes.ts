import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { container } from "../../app-container.js";
import { EscalationController } from "./escalation.controller.js";
import { createEscalationBody, escalationParams, updateEscalationBody } from "./escalation.schema.js";

const controller = new EscalationController(container.escalations);

/** Mounted at /api/v1/admin/conversations (authentication is applied at the mount). */
export const conversationEscalationRoutes = Router();

conversationEscalationRoutes.get("/:id/escalations", validate({ params: idParams }), controller.list);
conversationEscalationRoutes.post(
  "/:id/escalations",
  validate({ params: idParams, body: createEscalationBody }),
  controller.create,
);

/** Mounted at /api/v1/admin/escalations. */
export const escalationRoutes = Router();

escalationRoutes.patch(
  "/:escalationId",
  validate({ params: escalationParams, body: updateEscalationBody }),
  controller.close,
);
