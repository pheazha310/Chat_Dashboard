import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { NotificationRepository, NotificationService } from "@modules/notifications/index.js";
import { AssignmentController } from "./assignment.controller.js";
import { AssignmentRepository } from "./assignment.repository.js";
import { assignBody, transferBody, unassignBody } from "./assignment.schema.js";
import { AssignmentService } from "./assignment.service.js";

const controller = new AssignmentController(
  new AssignmentService(new AssignmentRepository(), new NotificationService(new NotificationRepository())),
);

/** Mounted at /api/conversations next to the conversation routes. */
export const assignmentRoutes = Router();

assignmentRoutes.post("/:id/assign", validate({ params: idParams, body: assignBody }), controller.assign);
assignmentRoutes.post("/:id/transfer", validate({ params: idParams, body: transferBody }), controller.transfer);
assignmentRoutes.post("/:id/unassign", validate({ params: idParams, body: unassignBody }), controller.unassign);
assignmentRoutes.get("/:id/assignments", validate({ params: idParams }), controller.history);
