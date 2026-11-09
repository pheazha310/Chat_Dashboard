import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { container } from "../../app-container.js";
import { AssignmentController } from "./assignment.controller.js";
import { assignBody, transferBody, unassignBody } from "./assignment.schema.js";

const controller = new AssignmentController(container.assignments);

/** Mounted at /api/v1/admin/conversations next to the conversation routes. */
export const assignmentRoutes = Router();

assignmentRoutes.post("/:id/assign", validate({ params: idParams, body: assignBody }), controller.assign);
assignmentRoutes.post("/:id/transfer", validate({ params: idParams, body: transferBody }), controller.transfer);
assignmentRoutes.post("/:id/unassign", validate({ params: idParams, body: unassignBody }), controller.unassign);
assignmentRoutes.get("/:id/assignments", validate({ params: idParams }), controller.history);
