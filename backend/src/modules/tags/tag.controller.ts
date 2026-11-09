import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import {
  conversationTagParams,
  createTagBody,
  deleteTagQuery,
  listTagsQuery,
  setTagsBody,
  tagParams,
  updateTagBody,
} from "./tag.schema.js";
import type { TagService } from "./tag.service.js";

export class TagController {
  constructor(private readonly service: TagService) {}

  list = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.list(parsed(req, "query", listTagsQuery));
    res.json({ status: "success", data: items, meta });
  };

  create = async (req: Request, res: Response) => {
    res
      .status(201)
      .json({ status: "success", data: await this.service.create(getAuth(req), parsed(req, "body", createTagBody)) });
  };

  update = async (req: Request, res: Response) => {
    const { tagId } = parsed(req, "params", tagParams);
    res.json({
      status: "success",
      data: await this.service.update(getAuth(req), tagId, parsed(req, "body", updateTagBody)),
    });
  };

  remove = async (req: Request, res: Response) => {
    const { tagId } = parsed(req, "params", tagParams);
    const { force } = parsed(req, "query", deleteTagQuery);
    res.json({ status: "success", data: await this.service.remove(getAuth(req), tagId, { force }) });
  };

  setConversationTags = async (req: Request, res: Response) => {
    const { id } = parsed(req, "params", conversationTagParams);
    res.json({
      status: "success",
      data: await this.service.setConversationTags(getAuth(req), id, parsed(req, "body", setTagsBody)),
    });
  };
}
