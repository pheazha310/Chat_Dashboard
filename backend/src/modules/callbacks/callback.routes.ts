import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { container } from "../../app-container.js";
import { CallbackController } from "./callback.controller.js";
import {
  callbackParams,
  completeCallbackBody,
  createCallbackBody,
  listCallbacksQuery,
  updateCallbackBody,
} from "./callback.schema.js";

const controller = new CallbackController(container.callbacks);

/** Mounted at /api/v1/admin/conversations (authentication is applied at the mount). */
export const conversationCallbackRoutes = Router();

conversationCallbackRoutes.get("/:id/callbacks", validate({ params: idParams }), controller.listForConversation);
conversationCallbackRoutes.post(
  "/:id/callbacks",
  validate({ params: idParams, body: createCallbackBody }),
  controller.create,
);

/** Mounted at /api/v1/admin/callbacks. */
export const callbackRoutes = Router();

callbackRoutes.get("/", validate({ query: listCallbacksQuery }), controller.list);
callbackRoutes.get("/:callbackId", validate({ params: callbackParams }), controller.get);
callbackRoutes.patch("/:callbackId", validate({ params: callbackParams, body: updateCallbackBody }), controller.update);
callbackRoutes.post(
  "/:callbackId/complete",
  validate({ params: callbackParams, body: completeCallbackBody }),
  controller.complete,
);
callbackRoutes.post("/:callbackId/cancel", validate({ params: callbackParams }), controller.cancel);
