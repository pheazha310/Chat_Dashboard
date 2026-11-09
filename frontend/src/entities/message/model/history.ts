import { getMessages } from "@/shared/api/rest";
import { toMessage } from "@/shared/api/backend/mappers";
import { isMockTransport } from "@/shared/api/ws";
import { notify } from "@/shared/ui";
import { newestSequences, useMessageStore } from "./store";

const PAGE = 50;
const MAX_CATCH_UP_PAGES = 20;

async function fetchPage(conversationId: string, params: { before?: string; after?: string; limit: number }) {
  const { items, meta } = await getMessages(conversationId, params);
  return { messages: items.map(toMessage), meta };
}

/**
 * Loads the newest page of a conversation's history the first time it is opened. With the mock transport the
 * messages arrive in `sync`, so there is nothing to load.
 */
export async function loadHistory(conversationId: string): Promise<void> {
  if (isMockTransport) return;
  const store = useMessageStore.getState();
  const state = store.history[conversationId];
  if (state?.loading || state?.loaded) return;

  store.setHistory(conversationId, { loading: true });
  try {
    const { messages, meta } = await fetchPage(conversationId, { limit: PAGE });
    const current = useMessageStore.getState();
    current.mergeMany({ [conversationId]: messages });
    current.setHistory(conversationId, {
      loading: false,
      loaded: true,
      hasMore: meta.hasMore,
      ...(meta.oldestSequence ? { oldest: meta.oldestSequence } : {}),
    });
  } catch {
    useMessageStore.getState().setHistory(conversationId, { loading: false });
    notify("Could not load the conversation history");
  }
}

/** "Load earlier messages": the page before the oldest one held. */
export async function loadOlderMessages(conversationId: string): Promise<void> {
  if (isMockTransport) return;
  const state = useMessageStore.getState().history[conversationId];
  if (!state || state.loading || !state.hasMore || !state.oldest) return;

  useMessageStore.getState().setHistory(conversationId, { loading: true });
  try {
    const { messages, meta } = await fetchPage(conversationId, { before: state.oldest, limit: PAGE });
    const current = useMessageStore.getState();
    current.mergeMany({ [conversationId]: messages });
    current.setHistory(conversationId, {
      loading: false,
      hasMore: meta.hasMore,
      ...(meta.oldestSequence ? { oldest: meta.oldestSequence } : {}),
    });
  } catch {
    useMessageStore.getState().setHistory(conversationId, { loading: false });
    notify("Could not load earlier messages");
  }
}

/**
 * After a reconnect the sync carries one page of what was missed; this pages through the rest for a conversation
 * the server flagged as `incomplete`.
 */
export async function catchUp(conversationId: string): Promise<void> {
  if (isMockTransport) return;
  for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
    const after = newestSequences(useMessageStore.getState().byConversation)[conversationId];
    if (after === undefined) return;
    try {
      const { messages, meta } = await fetchPage(conversationId, { after, limit: 100 });
      useMessageStore.getState().mergeMany({ [conversationId]: messages });
      if (!meta.hasMore || messages.length === 0) return;
    } catch {
      return;
    }
  }
}
