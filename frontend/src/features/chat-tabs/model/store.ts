import { create } from "zustand";
import { closeTabRequest, openTabRequest } from "@/shared/api/rest";
import { API_URL } from "@/shared/config";

type TabsState = {
  /** Open conversations in tab order. Never holds a duplicate. */
  openIds: string[];
  /** Replaces the tabs (restore on load, or a remote change). */
  setTabs: (ids: string[]) => void;
  add: (id: string) => void;
  remove: (id: string) => void;
};

export const useChatTabsStore = create<TabsState>((set) => ({
  openIds: [],
  setTabs: (ids) => set({ openIds: [...new Set(ids)] }),
  add: (id) => set((state) => (state.openIds.includes(id) ? state : { openIds: [...state.openIds, id] })),
  remove: (id) => set((state) => ({ openIds: state.openIds.filter((openId) => openId !== id) })),
}));

/** Persistence is best effort: the tab stays usable locally if the request fails, and runs only against the real backend. */
const persist = (request: Promise<unknown>) => void request.catch(() => {});

/** Opens a tab for the conversation (a no-op when it is already open). */
export function openTab(id: string) {
  if (useChatTabsStore.getState().openIds.includes(id)) return;
  useChatTabsStore.getState().add(id);
  if (API_URL) persist(openTabRequest(id));
}

/**
 * Closes the tab only; the conversation keeps its status, owner and messages. Returns the conversation to show next
 * (the neighbour of the closed tab) or null when no tabs remain.
 */
export function closeTab(id: string): string | null {
  const { openIds, remove } = useChatTabsStore.getState();
  const index = openIds.indexOf(id);
  if (index === -1) return null;
  remove(id);
  if (API_URL) persist(closeTabRequest(id));
  const rest = useChatTabsStore.getState().openIds;
  return rest[Math.min(index, rest.length - 1)] ?? null;
}
