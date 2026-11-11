import { create } from "zustand";
import { loadUntil, loadUntilMessage, useMessageStore } from "@/entities/message";
import { getMessages, searchMessages } from "@/shared/api/rest";
import { useSessionStore } from "@/shared/api/session";
import { isMockTransport } from "@/shared/api/ws";
import { notify } from "@/shared/ui";

/** A matching message. `sequence` is missing only for mock messages, which are always held. */
export type SearchHit = { id: string; sequence?: string };

type ChatSearchState = {
  open: boolean;
  query: string;
  /** Newest first, like the server returns them. */
  hits: SearchHit[];
  /** Index into `hits` of the result on screen. */
  active: number;
  searching: boolean;
  /** More than the server returned matched (shown as "100+"). */
  hasMore: boolean;
  /**
   * The message the chat should scroll to, set by search, the inbox search or "show in chat". `token` changes on
   * every jump so the same message can be shown again. Closing the search keeps it: it only matters when it changes.
   */
  focus?: { conversationId: string; id: string; token: number };
  /**
   * The last searches the agent actually used, newest first. Kept in memory only (they can hold customer data): gone
   * on reload, sign-out or when another agent signs in.
   */
  recent: string[];
  toggle: () => void;
  setQuery: (query: string) => void;
  close: () => void;
};

const CLEARED = { hits: [], active: 0, searching: false, hasMore: false };
const MAX_RECENT = 5;

/** Adds the current query to the recent searches if it found something. */
const remembered = (state: ChatSearchState): string[] => {
  const query = state.query.trim();
  if (!query || state.hits.length === 0) return state.recent;
  const others = state.recent.filter((item) => item.toLowerCase() !== query.toLowerCase());
  return [query, ...others].slice(0, MAX_RECENT);
};

export const useChatSearchStore = create<ChatSearchState>((set) => ({
  open: false,
  query: "",
  ...CLEARED,
  recent: [],
  toggle: () =>
    set((state) => (state.open ? { open: false, query: "", ...CLEARED, recent: remembered(state) } : { open: true })),
  setQuery: (query) => set({ query }),
  close: () => set((state) => ({ open: false, query: "", ...CLEARED, recent: remembered(state) })),
}));

useSessionStore.subscribe((session, previous) => {
  if (session.userId !== previous.userId) useChatSearchStore.setState({ recent: [] });
});

let latestRequest = 0;
let focusToken = 0;

/** Finds `query` in the whole conversation and shows the newest match. */
export async function runSearch(conversationId: string, query: string): Promise<void> {
  const request = ++latestRequest;
  const text = query.trim();
  if (!text) {
    useChatSearchStore.setState(CLEARED);
    return;
  }
  useChatSearchStore.setState({ searching: true });
  try {
    const { hits, hasMore } = isMockTransport
      ? { hits: searchHeld(conversationId, text), hasMore: false }
      : await searchServer(conversationId, text);
    if (request !== latestRequest) return; // the agent typed something else meanwhile
    useChatSearchStore.setState({ hits, hasMore, active: 0, searching: false });
  } catch {
    if (request !== latestRequest) return;
    useChatSearchStore.setState(CLEARED);
    notify("Search failed, please try again");
    return;
  }
  await show(conversationId, 0);
}

/** Moves to an older (1) or newer (-1) match, stopping at either end. */
export async function step(conversationId: string, direction: 1 | -1): Promise<void> {
  const { hits, active } = useChatSearchStore.getState();
  const next = active + direction;
  if (next < 0 || next >= hits.length) return;
  useChatSearchStore.setState((state) => ({ active: next, recent: remembered(state) }));
  await show(conversationId, next);
}

async function show(conversationId: string, index: number) {
  const hit = useChatSearchStore.getState().hits[index];
  if (!hit) return;
  if (!(await load(conversationId, hit))) return;
  if (useChatSearchStore.getState().hits[index] !== hit) return; // a newer search replaced it while loading
  useChatSearchStore.setState({ focus: { conversationId, id: hit.id, token: ++focusToken } });
}

/**
 * Loads a conversation back to a message and scrolls its chat there (an inbox search hit, a shared file). Without a
 * sequence number the history is paged until the message id turns up. Open the conversation first.
 */
export async function showMessage(conversationId: string, target: SearchHit): Promise<void> {
  if (!(await load(conversationId, target))) return;
  useChatSearchStore.setState({ focus: { conversationId, id: target.id, token: ++focusToken } });
}

/** Shows the first message written on or after a day (`YYYY-MM-DD`, the agent's own timezone). */
export async function jumpToDate(conversationId: string, day: string): Promise<void> {
  const [year, month, date] = day.split("-").map(Number);
  const from = new Date(year ?? 0, (month ?? 1) - 1, date ?? 1);
  let first: SearchHit | undefined;
  try {
    first = isMockTransport ? firstHeldFrom(conversationId, from) : await firstFromServer(conversationId, from);
  } catch {
    notify("Could not load that day, please try again");
    return;
  }
  if (!first) {
    notify("No messages on or after that day");
    return;
  }
  await showMessage(conversationId, first);
}

async function firstFromServer(conversationId: string, from: Date): Promise<SearchHit | undefined> {
  const { items } = await getMessages(conversationId, { from: from.toISOString(), limit: 1 });
  const [item] = items;
  return item && { id: item.id, sequence: item.sequenceNumber };
}

function firstHeldFrom(conversationId: string, from: Date): SearchHit | undefined {
  const held = useMessageStore.getState().byConversation[conversationId] ?? [];
  const found = held.find((m) => new Date(m.createdAt).getTime() >= from.getTime());
  return found && { id: found.id };
}

const load = (conversationId: string, target: SearchHit) =>
  target.sequence === undefined
    ? loadUntilMessage(conversationId, target.id)
    : loadUntil(conversationId, target.sequence);

async function searchServer(conversationId: string, text: string) {
  const { items, hasMore } = await searchMessages(conversationId, text);
  return { hits: items.map((item) => ({ id: item.id, sequence: item.sequenceNumber })), hasMore };
}

/** The mock server holds the whole thread in memory, so search it the way the server would. */
function searchHeld(conversationId: string, text: string): SearchHit[] {
  const needle = text.toLowerCase();
  return (useMessageStore.getState().byConversation[conversationId] ?? [])
    .filter((m) => m.side !== "system" && !m.deleted && m.text.toLowerCase().includes(needle))
    .map((m) => (m.sequence === undefined ? { id: m.id } : { id: m.id, sequence: m.sequence }))
    .reverse();
}
