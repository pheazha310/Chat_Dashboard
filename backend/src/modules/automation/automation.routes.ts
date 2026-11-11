import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { container } from "../../app-container.js";
import { AutomationController } from "./automation.controller.js";
import { approvalBody, autoResponsesBody, exampleParams, trainingExampleBody } from "./automation.schema.js";

const controller = new AutomationController(container.automation);

/** Mounted at /api/v1/admin/automation (authentication is applied at the mount). */
export const automationRoutes = Router();

automationRoutes.get("/auto-responses", controller.getAutoResponses);
automationRoutes.put("/auto-responses", validate({ body: autoResponsesBody }), controller.saveAutoResponses);

automationRoutes.get("/training-examples", controller.listExamples);
automationRoutes.post("/training-examples", validate({ body: trainingExampleBody }), controller.addExample);
automationRoutes.patch(
  "/training-examples/:exampleId",
  validate({ params: exampleParams, body: approvalBody }),
  controller.setApproval,
);
