import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { createNoteBody, noteParams, updateNoteBody } from "./note.schema.js";
import type { NoteService } from "./note.service.js";

export class NoteController {
  constructor(private readonly service: NoteService) {}

  list = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.list(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "query", pageQuery),
    );
    res.json({ status: "success", data: items, meta });
  };

  create = async (req: Request, res: Response) => {
    const data = await this.service.create(
      getAuth(req),
      parsed(req, "params", idParams).id,
      parsed(req, "body", createNoteBody),
    );
    res.status(201).json({ status: "success", data });
  };

  update = async (req: Request, res: Response) => {
    const { noteId } = parsed(req, "params", noteParams);
    res.json({
      status: "success",
      data: await this.service.update(getAuth(req), noteId, parsed(req, "body", updateNoteBody)),
    });
  };

  remove = async (req: Request, res: Response) => {
    const { noteId } = parsed(req, "params", noteParams);
    res.json({ status: "success", data: await this.service.remove(getAuth(req), noteId) });
  };
}
