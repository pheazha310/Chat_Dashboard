import { create } from "zustand";

export type SettingKey = "conversationAlerts" | "typingSound" | "autoAssign" | "aiReplies" | "aiSummaries";

type SettingsState = {
  open: boolean;
  values: Record<SettingKey, boolean>;
  setOpen: (open: boolean) => void;
  toggle: (key: SettingKey) => void;
};

export const useMessageSettingsStore = create<SettingsState>((set) => ({
  open: false,
  values: {
    conversationAlerts: true,
    typingSound: true,
    autoAssign: true,
    aiReplies: true,
    aiSummaries: true,
  },
  setOpen: (open) => set({ open }),
  toggle: (key) =>
    set((state) => ({
      values: { ...state.values, [key]: !state.values[key] },
    })),
}));
