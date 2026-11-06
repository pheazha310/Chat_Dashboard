import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { container } from "../../app-container.js";
import { CallController } from "./call.controller.js";
import { callParams, listCallsQuery, startCallBody } from "./call.schema.js";

const controller = new CallController(container.calls);

/** Mounted at /api/v1/admin/conversations (authentication is applied at the mount). */
export const conversationCallRoutes = Router();

conversationCallRoutes.get(
  "/:id/calls",
  validate({ params: idParams, query: listCallsQuery }),
  controller.listForConversation,
);
conversationCallRoutes.post("/:id/calls", validate({ params: idParams, body: startCallBody }), controller.start);

/** Mounted at /api/v1/admin/calls. Session descriptions and ICE candidates travel over the WebSocket, not here. */
export const callRoutes = Router();

callRoutes.get("/config", controller.config);
callRoutes.get("/:callId", validate({ params: callParams }), controller.get);
callRoutes.post("/:callId/accept", validate({ params: callParams }), controller.accept);
callRoutes.post("/:callId/decline", validate({ params: callParams }), controller.decline);
callRoutes.post("/:callId/cancel", validate({ params: callParams }), controller.cancel);
callRoutes.post("/:callId/end", validate({ params: callParams }), controller.end);
