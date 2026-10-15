import { create } from "zustand";
import { wsClient } from "@/shared/api/ws";
import { useMessageStore } from "@/entities/message";

type ComposerState = {
  drafts: Record<string, string>;
  attachments: Record<string, string>;
  recording: boolean;
  setDraft: (conversationId: string, text: string) => void;
  setAttachment: (conversationId: string, name: string) => void;
  toggleRecording: () => void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  drafts: {},
  attachments: {},
  recording: false,
  setDraft: (conversationId, text) => set((state) => ({ drafts: { ...state.drafts, [conversationId]: text } })),
  setAttachment: (conversationId, name) =>
    set((state) => ({ attachments: { ...state.attachments, [conversationId]: name } })),
  toggleRecording: () => set((state) => ({ recording: !state.recording })),
}));

export const useAttachment = (conversationId: string) =>
  useComposerStore((state) => state.attachments[conversationId] ?? "");

export const useDraft = (conversationId: string) => useComposerStore((state) => state.drafts[conversationId] ?? "");

/** Optimistically appends the message, then hands it to the socket (queued while offline). */
export function sendMessage(conversationId: string, rawText: string) {
  const text = rawText.trim();
  if (!text) return false;
  const clientId = `c-${crypto.randomUUID()}`;
  useMessageStore.getState().upsert({
    id: clientId,
    conversationId,
    side: "agent",
    text,
    createdAt: new Date().toISOString(),
    status: "sending",
  });
  wsClient.send("message.send", { conversationId, clientId, text });
  const composer = useComposerStore.getState();
  composer.setDraft(conversationId, "");
  composer.setAttachment(conversationId, "");
  return true;
}
