import { create } from "zustand";

const normalizeText = (value: string) =>
  value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

type ChatSearchState = {
  open: boolean;
  query: string;
  toggle: () => void;
  setQuery: (query: string) => void;
  close: () => void;
};

export const useChatSearchStore = create<ChatSearchState>((set) => ({
  open: false,
  query: "",
  toggle: () => set((state) => ({ open: !state.open })),
  setQuery: (query) => set({ query }),
  close: () => set({ open: false, query: "" }),
}));

export const matchesQuery = (text: string, query: string) => {
  const normalizedQuery = normalizeText(query);
  return !normalizedQuery || normalizeText(text).includes(normalizedQuery);
};

/** Filters items by query, normalizing the query once instead of per item. */
export const filterByQuery = <T>(items: T[], query: string, getText: (item: T) => string): T[] => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return items;
  return items.filter((item) => normalizeText(getText(item)).includes(normalizedQuery));
};
