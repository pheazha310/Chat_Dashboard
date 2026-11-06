import { create } from "zustand";
import type { ConversationDto } from "@/shared/api/ws";

export type Conversation = ConversationDto;

export type PriorityFilter = "all" | "HIGH" | "MEDIUM" | "LOW";
export type ConversationSort = "recent" | "priority";

export type ConversationFilter = "all" | "mine" | "unread" | "unassigned" | "archived";

type ConversationState = {
  byId: Record<string, Conversation>;
  order: string[];
  selectedId: string | null;
  query: string;
  filter: ConversationFilter;
  priorityFilter: PriorityFilter;
  /** Show only conversations carrying this tag. */
  tagFilter: string | null;
  sort: ConversationSort;
  setPriorityFilter: (value: PriorityFilter) => void;
  setTagFilter: (value: string | null) => void;
  setSort: (value: ConversationSort) => void;
  setAll: (conversations: Conversation[]) => void;
  upsert: (conversation: Conversation) => void;
  select: (id: string) => void;
  setQuery: (query: string) => void;
  setFilter: (filter: ConversationFilter) => void;
  /** Drops a conversation the agent can no longer see (someone else took it). */
  remove: (id: string) => void;
  /** Sets the authoritative unread count (read in another tab, marked unread, ...). */
  setUnread: (id: string, unread: number) => void;
  patch: (id: string, patch: Partial<Conversation>) => void;
  unarchiveLocally: (id: string) => void;
  markReadLocally: (id: string) => void;
  markUnreadLocally: (id: string) => void;
  assignToMeLocally: (id: string) => void;
  archiveLocally: (id: string) => void;
};

export const useConversationStore = create<ConversationState>((set) => ({
  byId: {},
  order: [],
  selectedId: null,
  query: "",
  filter: "all",
  priorityFilter: "all",
  tagFilter: null,
  sort: "recent",
  setPriorityFilter: (priorityFilter) => set({ priorityFilter }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  setSort: (sort) => set({ sort }),
  setAll: (conversations) =>
    set((state) => {
      const stillExists = conversations.some(({ id }) => id === state.selectedId);
      return {
        byId: Object.fromEntries(conversations.map((conversation) => [conversation.id, conversation])),
        order: conversations.map(({ id }) => id),
        // Keep the current selection if it survives the refresh; otherwise fall back to the first conversation.
        selectedId: stillExists ? state.selectedId : (conversations[0]?.id ?? null),
      };
    }),
  upsert: (conversation) =>
    set((state) => {
      const previous = state.byId[conversation.id];
      // Only move to the top on a new conversation or a new message, not on unread/handoff-only updates.
      const bumped = !previous || previous.lastMessageAt !== conversation.lastMessageAt;
      // Realtime events carry no history or summary; keep what was loaded for this conversation.
      const merged: Conversation = previous
        ? {
            ...conversation,
            activity: conversation.activity.length > 0 ? conversation.activity : previous.activity,
            summary: conversation.summary || previous.summary,
          }
        : conversation;
      return {
        byId: { ...state.byId, [conversation.id]: merged },
        order: bumped ? [conversation.id, ...state.order.filter((id) => id !== conversation.id)] : state.order,
      };
    }),
  select: (id) => set((state) => (state.byId[id] ? { selectedId: id } : state)),
  setQuery: (query) => set({ query }),
  setFilter: (filter) => set({ filter }),
  remove: (id) =>
    set((state) => {
      if (!state.byId[id]) return state;
      const { [id]: _removed, ...byId } = state.byId;
      const order = state.order.filter((other) => other !== id);
      return {
        byId,
        order,
        selectedId:
          state.selectedId === id ? (order.find((other) => !byId[other]?.archived) ?? null) : state.selectedId,
      };
    }),
  setUnread: (id, unread) =>
    set((state) => {
      const conversation = state.byId[id];
      if (!conversation || conversation.unread === unread) return state;
      return { byId: { ...state.byId, [id]: { ...conversation, unread } } };
    }),
  patch: (id, patch) =>
    set((state) => {
      const conversation = state.byId[id];
      return conversation ? { byId: { ...state.byId, [id]: { ...conversation, ...patch } } } : state;
    }),
  unarchiveLocally: (id) =>
    set((state) => {
      const conversation = state.byId[id];
      return conversation ? { byId: { ...state.byId, [id]: { ...conversation, archived: false } } } : state;
    }),
  markUnreadLocally: (id) =>
    set((state) => {
      const conversation = state.byId[id];
      if (!conversation) return state;
      return { byId: { ...state.byId, [id]: { ...conversation, unread: Math.max(1, conversation.unread) } } };
    }),
  assignToMeLocally: (id) =>
    set((state) => {
      const conversation = state.byId[id];
      if (!conversation) return state;
      return {
        byId: {
          ...state.byId,
          [id]: {
            ...conversation,
            handoff: "assigned",
            assignedAgent: { id: "local-agent", name: "You", avatar: "", active: true },
          },
        },
      };
    }),
  archiveLocally: (id) =>
    set((state) => {
      const conversation = state.byId[id];
      if (!conversation) return state;
      return {
        byId: { ...state.byId, [id]: { ...conversation, archived: true } },
        selectedId:
          state.selectedId === id
            ? (state.order.find((other) => other !== id && !state.byId[other]?.archived) ?? null)
            : state.selectedId,
      };
    }),
  markReadLocally: (id) =>
    set((state) => {
      const conversation = state.byId[id];
      if (!conversation || conversation.unread === 0) return state;
      return { byId: { ...state.byId, [id]: { ...conversation, unread: 0 } } };
    }),
}));

export const useSelectedConversation = () =>
  useConversationStore((state) => (state.selectedId ? state.byId[state.selectedId] : undefined));
