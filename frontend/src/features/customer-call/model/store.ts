import { create } from "zustand";
import type { Conversation } from "@/entities/conversation";
import { isMockTransport } from "@/shared/api/ws";
import { API_URL } from "@/shared/config";
import { startLiveCall } from "./live-call";

/**
 * Starts a call. Against the real backend that is a real call (live-call.ts); with the mock transport it opens the
 * old preview dialog, which only simulates one.
 */
export const useCustomerCallStore = create<{
  customer: Conversation | null;
  start: (customer: Conversation) => void;
  end: () => void;
}>((set) => ({
  customer: null,
  start: (customer) => {
    if (API_URL && !isMockTransport) void startLiveCall(customer);
    else set({ customer });
  },
  end: () => set({ customer: null }),
}));
