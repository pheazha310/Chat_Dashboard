import { toActivity, toConversation } from "@/shared/api/backend/mappers";
import { getActivities, getConversation, listConversations } from "@/shared/api/rest";
import { isMockTransport } from "@/shared/api/ws";
import { notify } from "@/shared/ui";
import { useConversationStore } from "./store";

const inFlight = new Set<string>();

/**
 * Fetches what the inbox does not carry: the summary and the activity timeline. With the mock transport both are
 * already part of the synced conversation.
 */
export async function loadDetails(conversationId: string): Promise<void> {
  if (isMockTransport || inFlight.has(conversationId)) return;
  inFlight.add(conversationId);
  try {
    const [detail, activities] = await Promise.all([getConversation(conversationId), getActivities(conversationId)]);
    useConversationStore.getState().patch(conversationId, {
      summary: detail.summary ?? "",
      activity: activities.map(toActivity),
    });
  } catch {
    // The chat still works without the side panel details; the next selection retries.
  } finally {
    inFlight.delete(conversationId);
  }
}

/** The inbox excludes archived conversations, so the Archived tab fetches them on demand. */
export async function loadArchived(): Promise<void> {
  if (isMockTransport) return;
  try {
    const archived = await listConversations({ filter: "archived", size: 100 });
    const store = useConversationStore.getState();
    for (const source of archived) store.upsert(toConversation(source, source.unreadCount ?? 0));
  } catch {
    notify("Could not load archived conversations");
  }
}
