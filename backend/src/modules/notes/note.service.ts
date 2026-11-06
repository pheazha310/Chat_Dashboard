import { logger } from "@config/logger.js";
import { BadRequestError, ForbiddenError, NotFoundError, ServiceUnavailableError } from "@shared/errors/AppError.js";
import { isSupervisor, type AuthContext } from "@shared/auth/auth.types.js";
import type { ConversationAccess } from "@shared/ports/conversation-access.js";
import type { AgentProfile, Directory } from "@shared/ports/directory.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import { pageMeta, type PageQuery } from "@shared/utils/pagination.js";
import type { NotificationService } from "@modules/notifications/index.js";
import type { NoteRepository } from "./note.repository.js";
import type { CreateNoteInput, UpdateNoteInput } from "./note.schema.js";
import type { NoteDto, NoteRow } from "./note.types.js";

const PREVIEW_LENGTH = 140;
const preview = (text: string) => Array.from(text).slice(0, PREVIEW_LENGTH).join("");

/**
 * Internal notes: staff-only comments on a conversation. Anyone who may see the conversation can read and add notes;
 * only the author edits, and the author or a supervisor deletes. Notes are stored apart from messages, so no message
 * API (history, sync, customer channel) can ever return them.
 */
export class NoteService {
  constructor(
    private readonly repository: NoteRepository,
    private readonly conversations: () => ConversationAccess,
    private readonly directory: Directory,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeNotifier,
  ) {}

  async list(auth: AuthContext, conversationId: string, query: PageQuery) {
    await this.conversations().requireVisible(auth, conversationId);
    const { items, total } = await this.repository.list(conversationId, query);
    const authors = await this.profiles(items.map((note) => note.authorAgentId));
    return { items: items.map((note) => toNote(note, auth, authors)), meta: pageMeta(total, query) };
  }

  async create(auth: AuthContext, conversationId: string, input: CreateNoteInput): Promise<NoteDto> {
    await this.conversations().requireVisible(auth, conversationId);
    const mentioned = this.others(auth, input.mentionedAgentIds);
    await this.checkMentions(conversationId, mentioned);

    const note = await this.repository.inTransaction(async (tx) => {
      const created = await tx.create({
        conversationId,
        authorAgentId: auth.userId,
        content: input.text,
        mentionedAgentIds: mentioned,
      });
      await tx.addCreatedActivity(conversationId, auth.userId, created.id);
      return created;
    });

    const dto = await this.present(note, auth);
    await this.publish("note.created", dto);
    await this.notifyMentioned(auth, note, mentioned);
    return dto;
  }

  async update(auth: AuthContext, noteId: string, input: UpdateNoteInput): Promise<NoteDto> {
    const existing = await this.requireNote(auth, noteId);
    if (existing.authorAgentId !== auth.userId) throw new ForbiddenError("You can only edit your own notes");

    const before = new Set(existing.noteMentions.map((m) => m.mentionedAgentId));
    const wanted = input.mentionedAgentIds === undefined ? undefined : this.others(auth, input.mentionedAgentIds);
    const added = (wanted ?? []).filter((id) => !before.has(id));
    await this.checkMentions(existing.conversationId, added);

    const changedText = input.text !== undefined && input.text !== existing.content;
    const changedMentions =
      wanted !== undefined && (wanted.length !== before.size || wanted.some((id) => !before.has(id)));
    if (!changedText && !changedMentions) return this.present(existing, auth);

    const updated = await this.repository.update(noteId, {
      ...(changedText ? { content: input.text as string } : {}),
      ...(changedMentions ? { mentionedAgentIds: wanted as string[] } : {}),
    });
    if (!updated) throw new NotFoundError("Note not found");

    const dto = await this.present(updated, auth);
    await this.publish("note.updated", dto);
    await this.notifyMentioned(auth, updated, added);
    return dto;
  }

  async remove(auth: AuthContext, noteId: string) {
    const existing = await this.requireNote(auth, noteId);
    if (existing.authorAgentId !== auth.userId && !isSupervisor(auth)) {
      throw new ForbiddenError("You can only delete your own notes");
    }
    if (!(await this.repository.softDelete(noteId))) throw new NotFoundError("Note not found");
    const result = { id: idToString(existing.id), conversationId: idToString(existing.conversationId) };
    await bestEffort("realtime note.deleted", () =>
      this.realtime.messageEvent(result.conversationId, "note.deleted", result),
    );
    return result;
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  /** A note the caller may see: the note's conversation must be visible to them, else it looks missing. */
  private async requireNote(auth: AuthContext, noteId: string): Promise<NoteRow> {
    const note = await this.repository.findLive(noteId);
    if (!note) throw new NotFoundError("Note not found");
    await this.conversations().requireVisible(auth, note.conversationId);
    return note;
  }

  /** Mentioning yourself does nothing; duplicates collapse. */
  private others(auth: AuthContext, ids: string[]) {
    return [...new Set(ids)].filter((id) => id !== auth.userId);
  }

  /**
   * Every mentioned agent must exist in Backend 1 and be able to open the conversation: a notification about a chat
   * they cannot see would leak it. They are checked as plain agents, so a supervisor who is not on the chat cannot
   * be mentioned until Backend 1 tells us more about roles.
   */
  private async checkMentions(conversationId: string, ids: string[]) {
    if (ids.length === 0) return;
    let known: AgentProfile[];
    try {
      known = await this.directory.getAgents(ids);
    } catch (error) {
      logger.warn({ err: error }, "agent directory unavailable while checking mentions");
      throw new ServiceUnavailableError("Agent directory is unavailable; try again shortly");
    }
    const exists = new Set(known.map((agent) => agent.id));
    const unknown = ids.filter((id) => !exists.has(id));
    if (unknown.length > 0) throw new BadRequestError("Unknown agents in mentionedAgentIds", { agentIds: unknown });

    const blind: string[] = [];
    for (const id of ids) {
      try {
        await this.conversations().requireVisible({ userId: id, role: "AGENT" }, conversationId);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
        blind.push(id);
      }
    }
    if (blind.length > 0) {
      throw new BadRequestError("Some mentioned agents cannot see this conversation", { agentIds: blind });
    }
  }

  private async notifyMentioned(auth: AuthContext, note: NoteRow, ids: string[]) {
    for (const agentId of ids) {
      await bestEffort("mention notification", async () => {
        await this.notifications.notifyAgent({
          agentId,
          type: "MENTION",
          title: "You were mentioned in an internal note",
          body: preview(note.content),
          conversationId: note.conversationId,
        });
      });
      await bestEffort("realtime note.mentioned", () =>
        this.realtime.agentEvent(agentId, "note.mentioned", {
          noteId: idToString(note.id),
          conversationId: idToString(note.conversationId),
          mentionedBy: auth.userId,
          preview: preview(note.content),
        }),
      );
    }
  }

  private publish(type: string, note: NoteDto) {
    // The payload is the author's view (permissions are the author's). Receivers recompute their own flags.
    const { permissions: _own, ...shared } = note;
    return bestEffort(`realtime ${type}`, () =>
      this.realtime.messageEvent(note.conversationId, type, { note: shared }),
    );
  }

  private async present(note: NoteRow, auth: AuthContext) {
    return toNote(note, auth, await this.profiles([note.authorAgentId]));
  }

  private async profiles(ids: string[]): Promise<Map<string, AgentProfile>> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return new Map();
    try {
      return new Map((await this.directory.getAgents(wanted)).map((agent) => [agent.id, agent]));
    } catch (error) {
      logger.warn({ err: error }, "agent profiles unavailable");
      return new Map();
    }
  }
}

function toNote(note: NoteRow, auth: AuthContext, authors: Map<string, AgentProfile>): NoteDto {
  const own = note.authorAgentId === auth.userId;
  return {
    id: idToString(note.id),
    conversationId: idToString(note.conversationId),
    authorAgentId: idToString(note.authorAgentId),
    author: authors.get(note.authorAgentId) ?? null,
    content: note.content,
    mentionedAgentIds: note.noteMentions.map((m) => idToString(m.mentionedAgentId)).sort(),
    isEdited: note.updatedAt.getTime() !== note.createdAt.getTime(),
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    permissions: { canEdit: own, canDelete: own || isSupervisor(auth) },
  };
}
