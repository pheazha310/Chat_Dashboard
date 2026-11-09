import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { can } from "@shared/auth/permissions.js";
import { permissionsFor } from "@shared/policy/conversation-access.js";
import type { ConversationAccess } from "@shared/ports/conversation-access.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import { pageMeta } from "@shared/utils/pagination.js";
import type { Tag } from "../../../prisma/generated/prisma/client.js";
import type { TagRepository, TagWithUsage } from "./tag.repository.js";
import type { CreateTagInput, ListTagsQuery, SetTagsInput, UpdateTagInput } from "./tag.schema.js";
import type { ConversationTagsDto, TagDto } from "./tag.types.js";

/**
 * The shared list of tags, and which of them a conversation carries. Any agent can create a tag; its creator or a
 * supervisor can rename or recolor it; only supervisors delete one, and a tag in use is only deleted on request
 * (`force`), after it has been taken off every conversation.
 */
export class TagService {
  constructor(
    private readonly repository: TagRepository,
    private readonly conversations: () => ConversationAccess,
    private readonly realtime: RealtimeNotifier,
  ) {}

  async list(query: ListTagsQuery) {
    const { items, total } = await this.repository.list(query);
    return { items: items.map(toTag), meta: pageMeta(total, query) };
  }

  async create(auth: AuthContext, input: CreateTagInput): Promise<TagDto> {
    await this.requireFreeName(input.name);
    const created = await this.repository.create({
      name: input.name,
      color: input.color ?? null,
      createdBy: auth.userId,
    });
    return toTag(created);
  }

  async update(auth: AuthContext, tagId: string, input: UpdateTagInput): Promise<TagDto> {
    const tag = await this.requireTag(tagId);
    if (tag.createdBy !== auth.userId && !can(auth, "tags.edit_any")) {
      throw new ForbiddenError("Only the tag's creator or a supervisor can change it");
    }
    if (input.name !== undefined && input.name.toLowerCase() !== tag.name.toLowerCase()) {
      await this.requireFreeName(input.name);
    }
    const updated = await this.repository.update(tagId, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.color === undefined ? {} : { color: input.color }),
    });
    // Open conversations show the old name until told.
    await this.announce(await this.repository.conversationIdsUsing(tagId));
    return toTag(updated);
  }

  async remove(auth: AuthContext, tagId: string, options: { force: boolean }) {
    if (!can(auth, "tags.delete")) throw new ForbiddenError("You are not allowed to delete tags");
    const tag = await this.requireTag(tagId);
    const affected = await this.repository.inTransaction(async (tx) => {
      const conversationIds = await tx.conversationIdsUsing(tagId);
      if (conversationIds.length > 0 && !options.force) {
        throw new ConflictError(
          `The tag is used by ${conversationIds.length} conversation(s); remove it from them or delete it with force=true`,
          { usageCount: conversationIds.length },
        );
      }
      // The links disappear with the tag (cascade); the timeline keeps a record on each conversation.
      await tx.addActivities(
        conversationIds.map((conversationId) => ({
          conversationId,
          agentId: auth.userId,
          type: "TAG_REMOVED" as const,
          tag,
        })),
      );
      if (!(await tx.delete(tagId))) throw new NotFoundError("Tag not found");
      return conversationIds;
    });
    await this.announce(affected);
    return { id: idToString(tag.id), removedFromConversations: affected.length };
  }

  /**
   * Makes the conversation's tags exactly `tagIds`. Allowed for whoever may organize the conversation (owner,
   * supervisor, or anyone while it has no owner). Adds and removals are recorded on the timeline. Simultaneous
   * changes to one conversation run one after the other.
   */
  async setConversationTags(
    auth: AuthContext,
    conversationId: string,
    input: SetTagsInput,
  ): Promise<ConversationTagsDto> {
    const state = await this.conversations().requireVisible(auth, conversationId);
    if (!permissionsFor(auth, state).canOrganize) {
      throw new ForbiddenError("Only the owner or a supervisor can change this conversation's tags");
    }
    const known = await this.repository.existingIds(input.tagIds);
    const unknown = input.tagIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new BadRequestError("Unknown tags in tagIds", { tagIds: unknown });

    const { tags, changed } = await this.repository.inTransaction(async (tx) => {
      await tx.lockConversation(conversationId);
      const before = await tx.tagsOf(conversationId);
      const have = new Set(before.map((tag) => tag.id));
      const want = new Set(input.tagIds);
      const removed = before.filter((tag) => !want.has(tag.id));
      const added = await tx.tagsByIds(input.tagIds.filter((id) => !have.has(id)));
      await tx.unlink(
        conversationId,
        removed.map((tag) => tag.id),
      );
      await tx.link(
        conversationId,
        added.map((tag) => tag.id),
      );
      const entry = (type: "TAG_ADDED" | "TAG_REMOVED") => (tag: Tag) => ({
        conversationId,
        agentId: auth.userId,
        type,
        tag,
      });
      await tx.addActivities([...added.map(entry("TAG_ADDED")), ...removed.map(entry("TAG_REMOVED"))]);
      return { tags: await tx.tagsOf(conversationId), changed: added.length + removed.length > 0 };
    });
    if (changed) await this.announce([conversationId]);
    return { conversationId: idToString(conversationId), tags: tags.map(toBrief) };
  }

  private async requireTag(id: string) {
    const tag = await this.repository.findById(id);
    if (!tag) throw new NotFoundError("Tag not found");
    return tag;
  }

  private async requireFreeName(name: string) {
    if (await this.repository.findByName(name)) throw new ConflictError(`A tag named "${name}" already exists`);
  }

  /** Tells everyone who can see each conversation that its tags changed (the event carries the new tag list). */
  private async announce(conversationIds: string[]) {
    for (const id of conversationIds) {
      await bestEffort("realtime conversation.tags_updated", () => this.realtime.conversationEvent(id, "tags_updated"));
    }
  }
}

const toBrief = (tag: Tag) => ({ id: idToString(tag.id), name: tag.name, color: tag.color });

const toTag = (tag: TagWithUsage): TagDto => ({
  id: idToString(tag.id),
  name: tag.name,
  color: tag.color,
  createdBy: tag.createdBy === null ? null : idToString(tag.createdBy),
  usageCount: tag._count.conversationTags,
  createdAt: tag.createdAt.toISOString(),
});
