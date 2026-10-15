import { create } from "zustand";
import type { SocketStatus } from "./client";
import { wsClient } from "./instance";

export const useConnectionStore = create<{ status: SocketStatus }>((set) => {
  wsClient.onStatus((status) => set({ status }));
  return { status: wsClient.status };
});
