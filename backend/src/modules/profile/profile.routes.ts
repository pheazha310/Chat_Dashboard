import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { container } from "../../app-container.js";
import { ProfileController } from "./profile.controller.js";
import { agentConversationsQuery } from "./profile.schema.js";

const controller = new ProfileController(container.profile);

/** Mounted at /api/v1/admin/agents (authentication is applied at the mount). */
export const agentProfileRoutes = Router();
agentProfileRoutes.get("/me", controller.agentMe);
agentProfileRoutes.get(
  "/me/conversations",
  validate({ query: agentConversationsQuery }),
  controller.agentConversations,
);

/** Mounted at /api/v1/customer (customer authentication is applied at the mount). */
export const customerProfileRoutes = Router();
customerProfileRoutes.get("/me", controller.customerMe);
customerProfileRoutes.get("/me/conversations", validate({ query: pageQuery }), controller.customerConversations);
