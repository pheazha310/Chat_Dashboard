import { prisma, runInTransaction, type Db } from "@config/database.js";
import { pageArgs } from "@shared/utils/pagination.js";
import type { Tag } from "../../../prisma/generated/prisma/client.js";
import type { ListTagsQuery } from "./tag.schema.js";

export type TagWithUsage = Tag & { _count: { conversationTags: number } };
const withUsage = { _count: { select: { conversationTags: true } } } as const;

export class TagRepository {
  constructor(private readonly db: Db = prisma) {}

  inTransaction<T>(fn: (repo: TagRepository) => Promise<T>): Promise<T> {
    return runInTransaction(this.db, (tx) => fn(new TagRepository(tx)));
  }

  async list(query: ListTagsQuery) {
    const where = {
      deletedAt: null,
      ...(query.q ? { name: { contains: query.q, mode: "insensitive" as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.tag.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        ...pageArgs(query),
        include: withUsage,
      }),
      this.db.tag.count({ where }),
    ]);
    return { items, total };
  }

  findById(id: string): Promise<TagWithUsage | null> {
    return this.db.tag.findFirst({ where: { id, deletedAt: null }, include: withUsage });
  }

  /** Names are unique ignoring case (also enforced by a database index). */
  findByName(name: string): Promise<Tag | null> {
    return this.db.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" }, deletedAt: null } });
  }

  create(data: { name: string; color: string | null; createdBy: string }): Promise<TagWithUsage> {
    return this.db.tag.create({ data, include: withUsage });
  }

  update(id: string, data: { name?: string; color?: string | null }): Promise<TagWithUsage> {
    return this.db.tag.update({ where: { id }, data, include: withUsage });
  }

  async conversationIdsUsing(tagId: string): Promise<string[]> {
    const rows = await this.db.conversationTag.findMany({ where: { tagId }, select: { conversationId: true } });
    return rows.map((row) => row.conversationId);
  }

  /** Soft delete: the tag and its links to conversations stay; every read hides a tag with `deleted_at` set. */
  async softDelete(id: string, deletedBy: string): Promise<boolean> {
    const { count } = await this.db.tag.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy },
    });
    return count === 1;
  }

  async existingIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db.tag.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  // ─── a conversation's tags ────────────────────────────────────────────────

  /** Serializes changes to one conversation's tags until the transaction ends. */
  async lockConversation(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM conversations WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async tagsOf(conversationId: string): Promise<Tag[]> {
    const rows = await this.db.conversationTag.findMany({
      where: { conversationId, tag: { deletedAt: null } },
      include: { tag: true },
      orderBy: { tag: { name: "asc" } },
    });
    return rows.map((row) => row.tag);
  }

  tagsByIds(ids: string[]): Promise<Tag[]> {
    return ids.length === 0
      ? Promise.resolve([])
      : this.db.tag.findMany({ where: { id: { in: ids }, deletedAt: null } });
  }

  async link(conversationId: string, tagIds: string[]): Promise<void> {
    await this.db.conversationTag.createMany({
      data: tagIds.map((tagId) => ({ conversationId, tagId })),
      skipDuplicates: true,
    });
  }

  async unlink(conversationId: string, tagIds: string[]): Promise<void> {
    await this.db.conversationTag.deleteMany({ where: { conversationId, tagId: { in: tagIds } } });
  }

  async addActivities(
    entries: { conversationId: string; agentId: string; type: "TAG_ADDED" | "TAG_REMOVED"; tag: Tag }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.db.conversationActivity.createMany({
      data: entries.map(({ conversationId, agentId, type, tag }) => ({
        conversationId,
        actorType: "AGENT",
        actorId: agentId,
        activityType: type,
        description: type === "TAG_ADDED" ? `Tag "${tag.name}" added` : `Tag "${tag.name}" removed`,
        metadata: { tagId: tag.id, tagName: tag.name },
      })),
    });
  }
}
