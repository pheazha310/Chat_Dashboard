import { create } from "zustand";
import { clearDraftRequest, saveDraftRequest } from "@/shared/api/rest";
import { wsClient } from "@/shared/api/ws";
import { API_URL } from "@/shared/config";
import { retryUpload } from "./files";
import { useMessageStore } from "@/entities/message";

type ComposerState = {
  drafts: Record<string, string>;
  attachments: Record<string, string>;
  recording: boolean;
  /** When the current voice recording started (ms since epoch), for the timer; null when not recording. */
  recordingSince: number | null;
  setDraft: (conversationId: string, text: string) => void;
  setAttachment: (conversationId: string, name: string) => void;
  toggleRecording: () => void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  drafts: {},
  attachments: {},
  recording: false,
  recordingSince: null,
  setDraft: (conversationId, text) => set((state) => ({ drafts: { ...state.drafts, [conversationId]: text } })),
  setAttachment: (conversationId, name) =>
    set((state) => ({ attachments: { ...state.attachments, [conversationId]: name } })),
  toggleRecording: () => set((state) => ({ recording: !state.recording })),
}));

const DRAFT_SAVE_DELAY_MS = 800;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** When this window last changed each draft; remote updates older than that are ignored so typing is never overwritten. */
const localEdits = new Map<string, number>();

/** The composer's change handler: updates the draft now and saves it to the server shortly after typing stops. */
export function updateDraft(conversationId: string, text: string) {
  useComposerStore.getState().setDraft(conversationId, text);
  if (!API_URL) return;
  localEdits.set(conversationId, Date.now());
  clearTimeout(saveTimers.get(conversationId));
  saveTimers.set(
    conversationId,
    setTimeout(() => {
      saveTimers.delete(conversationId);
      void saveDraftRequest(conversationId, text).catch(() => {});
    }, DRAFT_SAVE_DELAY_MS),
  );
}

/**
 * Puts text (a saved reply) into the draft of a conversation. It is only inserted: the agent can edit it and decides
 * when to send. Existing text is kept, with the insert on a new line.
 */
export function insertIntoDraft(conversationId: string, text: string) {
  const current = useComposerStore.getState().drafts[conversationId] ?? "";
  updateDraft(conversationId, current.trim() ? `${current.replace(/\s+$/, "")}\n${text}` : text);
}

/** Drafts loaded from the server on startup. A draft already typed in this window wins. */
export function hydrateDrafts(drafts: { conversationId: string; content: string }[]) {
  const current = useComposerStore.getState().drafts;
  const missing = drafts.filter((draft) => !current[draft.conversationId]);
  if (missing.length === 0) return;
  useComposerStore.setState({
    drafts: { ...current, ...Object.fromEntries(missing.map((d) => [d.conversationId, d.content])) },
  });
}

/** A draft changed in another window of this agent (`workspace.draft_updated`). */
export function applyRemoteDraft(conversationId: string, content: string | null, updatedAt: string) {
  if (Date.parse(updatedAt) < (localEdits.get(conversationId) ?? 0)) return;
  useComposerStore.getState().setDraft(conversationId, content ?? "");
}

export const useAttachment = (conversationId: string) =>
  useComposerStore((state) => state.attachments[conversationId] ?? "");

export const useDraft = (conversationId: string) => useComposerStore((state) => state.drafts[conversationId] ?? "");

/** Re-sends a message that failed, reusing its client id so the server ack replaces it. */
export function retryMessage(conversationId: string, messageId: string) {
  if (retryUpload(messageId)) return true;
  const messages = useMessageStore.getState();
  const failed = messages.byConversation[conversationId]?.find((m) => m.id === messageId && m.status === "failed");
  if (!failed) return false;
  messages.setStatus(conversationId, messageId, "sending");
  wsClient.send("message.send", {
    conversationId,
    clientId: messageId,
    text: failed.text,
    ...(failed.replyToId ? { replyToMessageId: failed.replyToId } : {}),
  });
  return true;
}

/** Optimistically appends the message, then hands it to the socket (queued while offline). */
export function sendMessage(conversationId: string, rawText: string) {
  const text = rawText.trim();
  if (!text) return false;
  const clientId = `c-${crypto.randomUUID()}`;
  const replyToMessageId = useMessageStore.getState().replyTarget[conversationId];
  useMessageStore.getState().upsert({
    id: clientId,
    conversationId,
    side: "agent",
    text,
    createdAt: new Date().toISOString(),
    status: "sending",
    ...(replyToMessageId ? { replyToId: replyToMessageId } : {}),
  });
  wsClient.send("message.send", { conversationId, clientId, text, ...(replyToMessageId ? { replyToMessageId } : {}) });
  useMessageStore.getState().setReplyTarget(conversationId, undefined);
  const composer = useComposerStore.getState();
  composer.setDraft(conversationId, "");
  composer.setAttachment(conversationId, "");
  clearTimeout(saveTimers.get(conversationId));
  saveTimers.delete(conversationId);
  if (API_URL) {
    localEdits.set(conversationId, Date.now());
    void clearDraftRequest(conversationId).catch(() => {});
  }
  return true;
}
