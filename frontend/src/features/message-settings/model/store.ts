import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { updateChatSettings, type ChatSettings } from "@/shared/api/rest";
import { isMockTransport } from "@/shared/api/ws";
import { API_URL } from "@/shared/config";
import { notify } from "@/shared/ui";

export type SettingKey = "conversationAlerts" | "typingSound" | "autoAssign" | "aiReplies" | "aiSummaries";

/**
 * The switches the backend stores per agent (docs/api-chat-settings.md). "New conversation alerts" has no backend
 * counterpart, so it stays in this browser only. The AI and auto-assign switches are stored, but nothing reads them yet.
 */
const REMOTE_KEYS: Partial<Record<SettingKey, keyof ChatSettings>> = {
  typingSound: "typingSoundEnabled",
  autoAssign: "autoAssignEnabled",
  aiReplies: "aiSuggestionsEnabled",
  aiSummaries: "aiSummariesEnabled",
};

/** Counts saves per switch, so a late failure of an old save can be told apart from the newest one. */
const latestSave: Partial<Record<SettingKey, number>> = {};

const syncsWithBackend = () => Boolean(API_URL) && !isMockTransport;

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
  /** Takes the agent's saved switches from the backend (initial load, or a change made in another window). */
  applyRemote: (settings: ChatSettings) => void;
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
      toggle: (key) => {
        const next = !useMessageSettingsStore.getState().values[key];
        set((state) => ({ values: { ...state.values, [key]: next } }));
        const remoteKey = REMOTE_KEYS[key];
        if (!remoteKey || !syncsWithBackend()) return;
        // Saved right away; if the server refuses, the switch goes back so the screen never lies. Only the newest
        // save of a switch may undo it: an older failure must not override what the agent chose afterwards.
        const request = (latestSave[key] = (latestSave[key] ?? 0) + 1);
        void updateChatSettings({ [remoteKey]: next }).catch(() => {
          if (latestSave[key] === request) set((state) => ({ values: { ...state.values, [key]: !next } }));
          notify("Could not save your setting");
        });
      },
      applyRemote: (settings) =>
        set((state) => {
          const values = { ...state.values };
          for (const [key, remoteKey] of Object.entries(REMOTE_KEYS) as [SettingKey, keyof ChatSettings][]) {
            values[key] = settings[remoteKey];
          }
          return { values };
        }),
    }),
    {
      name: "chat-dashboard-message-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ open: _open, ...state }) => state,
    },
  ),
);
