import { create } from "zustand";
import { useConversationStore } from "@/entities/conversation";
import { createTagRequest, listTags, setConversationTagsRequest, setPriorityRequest } from "@/shared/api/rest";
import type { Priority, TagRefDto } from "@/shared/api/ws";
import { notify } from "@/shared/ui";

type TagsState = {
  tags: TagRefDto[];
  status: "idle" | "loading" | "ready" | "error";
  set: (tags: TagRefDto[], status: TagsState["status"]) => void;
};

/** Every tag that exists (not only those on loaded conversations), for the tag picker. */
export const useTagCatalog = create<TagsState>((set) => ({
  tags: [],
  status: "idle",
  set: (tags, status) => set({ tags, status }),
}));

const failure = (error: unknown, fallback: string) => notify(error instanceof Error ? error.message : fallback);

export async function loadTagCatalog() {
  const catalog = useTagCatalog.getState();
  useTagCatalog.setState({ status: "loading" });
  try {
    const tags = await listTags();
    catalog.set(
      tags.map(({ id, name, color }) => ({ id, name, color })),
      "ready",
    );
  } catch {
    useTagCatalog.setState({ status: "error" });
  }
}

/** Creates a tag and returns it, or null with a notice (for example when the name is taken). */
export async function createTag(name: string): Promise<TagRefDto | null> {
  try {
    const created = await createTagRequest(name.trim());
    const tag = { id: created.id, name: created.name, color: created.color };
    useTagCatalog.setState((state) => ({ tags: [...state.tags, tag].sort((a, b) => a.name.localeCompare(b.name)) }));
    return tag;
  } catch (error) {
    failure(error, "Could not create the tag");
    return null;
  }
}

/** Sets the conversation's tags. The list updates from the server's answer, not before. */
export async function setConversationTags(conversationId: string, tagIds: string[]) {
  try {
    const { tags } = await setConversationTagsRequest(conversationId, tagIds);
    useConversationStore.getState().patch(conversationId, { tags });
    return true;
  } catch (error) {
    failure(error, "Could not update the tags");
    return false;
  }
}

export async function setPriority(conversationId: string, priority: Priority) {
  try {
    await setPriorityRequest(conversationId, priority);
    useConversationStore.getState().patch(conversationId, { priority, urgent: priority === "HIGH" });
    return true;
  } catch (error) {
    failure(error, "Could not change the priority");
    return false;
  }
}
