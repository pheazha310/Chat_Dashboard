import { getMessages } from "@/shared/api/rest";
import { toMessage } from "@/shared/api/backend/mappers";
import { isMockTransport } from "@/shared/api/ws";
import { notify } from "@/shared/ui";
import { newestSequences, useMessageStore } from "./store";

const PAGE = 50;
/** The server's largest page: jumping far back takes as few requests as possible. */
const MAX_PAGE = 100;
const MAX_CATCH_UP_PAGES = 20;

async function fetchPage(conversationId: string, params: { before?: string; after?: string; limit: number }) {
  const { items, meta } = await getMessages(conversationId, params);
  return { messages: items.map(toMessage), meta };
}

/**
 * Loads the newest page of a conversation's history the first time it is opened. With the mock transport the
 * messages arrive in `sync`, so there is nothing to load.
 */
export function loadHistory(conversationId: string): Promise<void> {
  if (isMockTransport) return Promise.resolve();
  // A second caller (e.g. a jump to a search hit while the chat opens) waits for the same first page.
  const running = firstPages.get(conversationId);
  if (running) return running;
  if (useMessageStore.getState().history[conversationId]?.loaded) return Promise.resolve();
  const loading = loadFirstPage(conversationId).finally(() => firstPages.delete(conversationId));
  firstPages.set(conversationId, loading);
  return loading;
}

const firstPages = new Map<string, Promise<void>>();

async function loadFirstPage(conversationId: string): Promise<void> {
  const store = useMessageStore.getState();
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
  await loadOlder(conversationId, PAGE);
}

/** One page before the oldest message held. False when there is nothing more, another load is running, or it failed. */
async function loadOlder(conversationId: string, limit: number): Promise<boolean> {
  const state = useMessageStore.getState().history[conversationId];
  if (!state || state.loading || !state.hasMore || !state.oldest) return false;

  useMessageStore.getState().setHistory(conversationId, { loading: true });
  try {
    const { messages, meta } = await fetchPage(conversationId, { before: state.oldest, limit });
    const current = useMessageStore.getState();
    current.mergeMany({ [conversationId]: messages });
    current.setHistory(conversationId, {
      loading: false,
      hasMore: meta.hasMore,
      ...(meta.oldestSequence ? { oldest: meta.oldestSequence } : {}),
    });
    return true;
  } catch {
    useMessageStore.getState().setHistory(conversationId, { loading: false });
    notify("Could not load earlier messages");
    return false;
  }
}

/**
 * Pages back until the message with `sequence` is held (to jump to a search hit or a quoted reply). Pages are joined
 * to what is held, so the thread never has gaps. True when the message is held.
 */
export async function loadUntil(conversationId: string, sequence: string): Promise<boolean> {
  if (isMockTransport) return true; // the mock holds the whole thread
  await loadHistory(conversationId);
  const target = BigInt(sequence);
  for (;;) {
    const oldest = useMessageStore.getState().history[conversationId]?.oldest;
    if (oldest !== undefined && BigInt(oldest) <= target) return true;
    if (!(await loadOlder(conversationId, MAX_PAGE))) return false;
  }
}

/** Like `loadUntil`, for a message known only by id (e.g. the message a shared file was sent with). */
export async function loadUntilMessage(conversationId: string, messageId: string): Promise<boolean> {
  const held = () => useMessageStore.getState().byConversation[conversationId]?.some((m) => m.id === messageId);
  if (isMockTransport) return !!held();
  await loadHistory(conversationId);
  while (!held()) {
    if (!(await loadOlder(conversationId, MAX_PAGE))) return false;
  }
  return true;
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
