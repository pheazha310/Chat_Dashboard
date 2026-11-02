import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type SettingKey = "conversationAlerts" | "typingSound" | "autoAssign" | "aiReplies" | "aiSummaries";

type SettingsState = {
  open: boolean;
  values: Record<SettingKey, boolean>;
  awayMessage: string;
  firstResponse: string;
  blockedCustomers: string[];
  blockedKeywords: string[];
  trainingExamples: { id: string; prompt: string; reply: string; approved: boolean }[];
  saveResponses: (awayMessage: string, firstResponse: string) => void;
  setList: (key: "blockedCustomers" | "blockedKeywords", values: string[]) => void;
  addExample: (prompt: string, reply: string) => void;
  toggleApproval: (id: string) => void;
  setOpen: (open: boolean) => void;
  toggle: (key: SettingKey) => void;
};

export const useMessageSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      open: false,
      awayMessage: "Thanks for your message. We’re currently away and will reply as soon as possible.",
      firstResponse: "Hi! Thanks for reaching out. How can we help you today?",
      blockedCustomers: [],
      blockedKeywords: [],
      trainingExamples: [],
      saveResponses: (awayMessage, firstResponse) => set({ awayMessage, firstResponse }),
      setList: (key, values) => set({ [key]: values }),
      addExample: (prompt, reply) =>
        set((state) => ({
          trainingExamples: [...state.trainingExamples, { id: crypto.randomUUID(), prompt, reply, approved: false }],
        })),
      toggleApproval: (id) =>
        set((state) => ({
          trainingExamples: state.trainingExamples.map((item) =>
            item.id === id ? { ...item, approved: !item.approved } : item,
          ),
        })),
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
    }),
    {
      name: "chat-dashboard-message-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ open: _open, ...state }) => state,
    },
  ),
);
