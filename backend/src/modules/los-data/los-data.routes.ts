import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { loanApplications } from "../../app-container.js";
import { LoanApplicationController } from "./los-data.controller.js";

const controller = new LoanApplicationController(loanApplications);

/** Mounted at /api/v1/admin/conversations (authentication is applied at the mount). */
export const loanApplicationRoutes = Router();

loanApplicationRoutes.get("/:id/application", validate({ params: idParams }), controller.application);
