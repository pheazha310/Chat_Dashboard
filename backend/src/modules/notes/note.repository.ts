import { prisma, runInTransaction, type Db } from "@config/database.js";
import { pageArgs, type PageQuery } from "@shared/utils/pagination.js";
import type { NoteRow } from "./note.types.js";

const withMentions = { noteMentions: true } as const;

export class NoteRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: NoteRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new NoteRepository(tx)));
  }

  /** A note that is not deleted. */
  findLive(id: string): Promise<NoteRow | null> {
    return this.db.internalNote.findFirst({ where: { id, deletedAt: null }, include: withMentions });
  }

  async list(conversationId: string, page: PageQuery) {
    const where = { conversationId, deletedAt: null };
    const [items, total] = await Promise.all([
      this.db.internalNote.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pageArgs(page),
        include: withMentions,
      }),
      this.db.internalNote.count({ where }),
    ]);
    return { items, total };
  }

  async create(data: { conversationId: string; authorAgentId: string; content: string; mentionedAgentIds: string[] }) {
    return this.db.internalNote.create({
      data: {
        conversationId: data.conversationId,
        authorAgentId: data.authorAgentId,
        content: data.content,
        noteMentions: { create: data.mentionedAgentIds.map((mentionedAgentId) => ({ mentionedAgentId })) },
      },
      include: withMentions,
    });
  }

  /** Writes the timeline entry; the text of the note is deliberately not copied into it. */
  async addCreatedActivity(conversationId: string, agentId: string, noteId: string) {
    await this.db.conversationActivity.create({
      data: {
        conversationId,
        actorType: "AGENT",
        actorId: agentId,
        activityType: "NOTE_ADDED",
        description: "Internal note added",
        metadata: { noteId },
      },
    });
  }

  /** Changes the text and/or replaces the mention list. Returns null if the note was deleted meanwhile. */
  async update(id: string, patch: { content?: string; mentionedAgentIds?: string[] }): Promise<NoteRow | null> {
    if (patch.content !== undefined) {
      const { count } = await this.db.internalNote.updateMany({
        where: { id, deletedAt: null },
        data: { content: patch.content, updatedAt: new Date() },
      });
      if (count === 0) return null;
    }
    if (patch.mentionedAgentIds !== undefined) {
      await this.db.noteMention.deleteMany({
        where: { noteId: id, mentionedAgentId: { notIn: patch.mentionedAgentIds } },
      });
      await this.db.noteMention.createMany({
        data: patch.mentionedAgentIds.map((mentionedAgentId) => ({ noteId: id, mentionedAgentId })),
        skipDuplicates: true,
      });
      await this.db.internalNote.updateMany({ where: { id, deletedAt: null }, data: { updatedAt: new Date() } });
    }
    return this.findLive(id);
  }

  /** Soft delete. Returns false if someone else already did. */
  async softDelete(id: string): Promise<boolean> {
    const { count } = await this.db.internalNote.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count === 1;
  }
}
