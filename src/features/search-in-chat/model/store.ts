import { create } from "zustand";

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

export const matchesQuery = (text: string, query: string) => text.toLowerCase().includes(query.toLowerCase());
