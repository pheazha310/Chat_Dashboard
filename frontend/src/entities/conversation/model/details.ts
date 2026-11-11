import { toActivity, toConversation } from "@/shared/api/backend/mappers";
import { getActivities, getConversation, listConversations, listConversationsPage } from "@/shared/api/rest";
import { isMockTransport } from "@/shared/api/ws";
import { notify } from "@/shared/ui";
import { INBOX_PAGE_SIZE, useConversationStore } from "./store";

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

/**
 * Makes sure a conversation is held before it is opened. A search hit can belong to one the inbox has not loaded
 * (an older page, or archived). True when it is held.
 */
export async function ensureConversation(conversationId: string): Promise<boolean> {
  if (useConversationStore.getState().byId[conversationId]) return true;
  if (isMockTransport) return false;
  try {
    const detail = await getConversation(conversationId);
    useConversationStore.getState().upsert(toConversation(detail, detail.unreadCount ?? 0));
    return true;
  } catch {
    notify("Could not open that conversation");
    return false;
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

/** Fetches the next inbox page (the socket sync only carries the first) and appends it below the loaded ones. */
export async function loadMoreConversations(): Promise<void> {
  const { inboxPage, inboxHasMore, inboxLoading } = useConversationStore.getState();
  if (isMockTransport || !inboxHasMore || inboxLoading) return;
  useConversationStore.setState({ inboxLoading: true });
  try {
    const page = inboxPage + 1;
    const { data, meta } = await listConversationsPage({ filter: "all", page, size: INBOX_PAGE_SIZE });
    useConversationStore.getState().appendPage(
      data.map((source) => toConversation(source, source.unreadCount ?? 0)),
      page,
      page < meta.totalPages,
    );
  } catch {
    notify("Could not load more conversations");
  } finally {
    useConversationStore.setState({ inboxLoading: false });
  }
}
