import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { container } from "../../app-container.js";
import { PresenceController } from "./presence.controller.js";
import { setPresenceBody } from "./presence.schema.js";

const controller = new PresenceController(container.presence);

/** Mounted at /api/v1/admin/presence (authentication is applied at the mount). */
export const presenceRoutes = Router();

presenceRoutes.get("/", controller.list);
presenceRoutes.put("/me", validate({ body: setPresenceBody }), controller.setMine);
