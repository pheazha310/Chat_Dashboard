import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { container } from "../../app-container.js";
import { TagController } from "./tag.controller.js";
import {
  conversationTagParams,
  createTagBody,
  deleteTagQuery,
  listTagsQuery,
  setTagsBody,
  tagParams,
  updateTagBody,
} from "./tag.schema.js";

const controller = new TagController(container.tags);

/** Mounted at /api/v1/admin/tags (authentication is applied at the mount). */
export const tagRoutes = Router();

tagRoutes.get("/", validate({ query: listTagsQuery }), controller.list);
tagRoutes.post("/", validate({ body: createTagBody }), controller.create);
tagRoutes.patch("/:tagId", validate({ params: tagParams, body: updateTagBody }), controller.update);
tagRoutes.delete("/:tagId", validate({ params: tagParams, query: deleteTagQuery }), controller.remove);

/** Mounted at /api/v1/admin/conversations. */
export const conversationTagRoutes = Router();

conversationTagRoutes.put(
  "/:id/tags",
  validate({ params: conversationTagParams, body: setTagsBody }),
  controller.setConversationTags,
);
