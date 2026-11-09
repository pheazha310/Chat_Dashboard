import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { container } from "../../app-container.js";
import { CustomerController } from "./customer.controller.js";

const controller = new CustomerController(container.customers);

/** Mounted at /api/v1/admin/conversations (authentication is applied at the mount). */
export const customerRoutes = Router();

customerRoutes.get("/:id/customer", validate({ params: idParams }), controller.customer);
customerRoutes.get(
  "/:id/customer/conversations",
  validate({ params: idParams, query: pageQuery }),
  controller.otherConversations,
);
customerRoutes.get("/:id/participants", validate({ params: idParams }), controller.participants);
