import { Router } from "express";
import { validate } from "@shared/middleware/validate.middleware.js";
import { idParams } from "@shared/utils/ids.js";
import { pageQuery } from "@shared/utils/pagination.js";
import { container } from "../../app-container.js";
import { NoteController } from "./note.controller.js";
import { createNoteBody, noteParams, updateNoteBody } from "./note.schema.js";

const controller = new NoteController(container.notes);

/** Mounted at /api/v1/admin/conversations (authentication is applied at the mount). */
export const conversationNoteRoutes = Router();

conversationNoteRoutes.get("/:id/notes", validate({ params: idParams, query: pageQuery }), controller.list);
conversationNoteRoutes.post("/:id/notes", validate({ params: idParams, body: createNoteBody }), controller.create);

/** Mounted at /api/v1/admin/notes. */
export const noteRoutes = Router();

noteRoutes.patch("/:noteId", validate({ params: noteParams, body: updateNoteBody }), controller.update);
noteRoutes.delete("/:noteId", validate({ params: noteParams }), controller.remove);
