import { create } from "zustand";
import type { Conversation } from "@/entities/conversation";

export const useCustomerCallStore = create<{
  customer: Conversation | null;
  start: (customer: Conversation) => void;
  end: () => void;
}>((set) => ({
  customer: null,
  start: (customer) => set({ customer }),
  end: () => set({ customer: null }),
}));
