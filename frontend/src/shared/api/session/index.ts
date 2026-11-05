import { create } from "zustand";

type SessionState = {
  /** Backend 1 user id of the signed-in agent, once the connection has authenticated. */
  userId: string | null;
  role: string | null;
  set: (session: { userId: string | null; role: string | null }) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  userId: null,
  role: null,
  set: ({ userId, role }) => set({ userId, role }),
}));

/** Whether the conversation is assigned to the signed-in agent. */
export const isMine = (assignedAgentId: string | undefined) =>
  assignedAgentId !== undefined && assignedAgentId === useSessionStore.getState().userId;
