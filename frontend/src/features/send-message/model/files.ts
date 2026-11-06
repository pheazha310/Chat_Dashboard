import { create } from "zustand";
import { useMessageStore } from "@/entities/message";
import { ApiError, uploadFileRequest, uploadVoiceRequest } from "@/shared/api/rest";
import { toMessage } from "@/shared/api/backend/mappers";
import { API_URL } from "@/shared/config";
import { notify } from "@/shared/ui";
import { useComposerStore } from "./store";

/** Types the server accepts (docs/api-attachments.md); the server checks the content too. */
export const ACCEPTED_FILES =
  ".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.mp3,.ogg,.wav,.m4a,.mp4,.webm,.mov";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Upload progress (0 to 1) by message client id, for the chip shown while a file is on its way. */
export const useUploadStore = create<{
  progress: Record<string, number>;
  set: (id: string, value: number | null) => void;
}>((set) => ({
  progress: {},
  set: (id, value) =>
    set((state) => {
      const { [id]: _removed, ...rest } = state.progress;
      return { progress: value === null ? rest : { ...rest, [id]: value } };
    }),
}));

type Pending = { conversationId: string; file: File; text: string; voice?: { durationMs: number } };
/** The file chosen for each conversation, waiting for the agent to press send. */
const chosen = new Map<string, File>();
/** Uploads that failed, kept so "Retry" can send the same file again with the same client id. */
const failed = new Map<string, Pending>();

export const hasChosenFile = (conversationId: string) => chosen.has(conversationId);

/** Picks a file for the next message. Returns an error text when it cannot be sent. */
export function chooseFile(conversationId: string, file: File): string | null {
  if (file.size === 0) return "That file is empty";
  if (file.size > MAX_FILE_BYTES) return "Files can be at most 25 MB";
  chosen.set(conversationId, file);
  useComposerStore.getState().setAttachment(conversationId, file.name);
  return null;
}

export function clearChosenFile(conversationId: string) {
  chosen.delete(conversationId);
  useComposerStore.getState().setAttachment(conversationId, "");
}

const describe = (error: unknown) =>
  error instanceof ApiError || error instanceof Error ? error.message : "The file could not be sent";

/** Sends the chosen file with the draft as caption. The message shows at once as "sending" and fills in when the server answers. */
export function sendChosenFile(conversationId: string): boolean {
  const file = chosen.get(conversationId);
  if (!file || !API_URL) return false;
  const text = useComposerStore.getState().drafts[conversationId]?.trim() ?? "";
  chosen.delete(conversationId);
  const composer = useComposerStore.getState();
  composer.setDraft(conversationId, "");
  composer.setAttachment(conversationId, "");
  void deliver(`c-${crypto.randomUUID()}`, { conversationId, file, text });
  return true;
}

/** Sends a finished voice recording. */
export function sendVoice(conversationId: string, file: File, durationMs: number) {
  void deliver(`c-${crypto.randomUUID()}`, { conversationId, file, text: "", voice: { durationMs } });
}

async function deliver(clientId: string, pending: Pending) {
  const { conversationId, file, text, voice } = pending;
  const messages = useMessageStore.getState();
  const uploads = useUploadStore.getState();
  messages.upsert({
    id: clientId,
    conversationId,
    side: "agent",
    text: text || (voice ? "Voice message" : file.name),
    createdAt: new Date().toISOString(),
    status: "sending",
  });
  uploads.set(clientId, 0);
  failed.delete(clientId);
  try {
    const options = { clientId, onProgress: (fraction: number) => useUploadStore.getState().set(clientId, fraction) };
    const stored = voice
      ? await uploadVoiceRequest(conversationId, file, { ...options, durationMs: voice.durationMs })
      : await uploadFileRequest(conversationId, file, { ...options, ...(text ? { text } : {}) });
    // The server copy carries the same clientId, so it replaces the optimistic one.
    useMessageStore.getState().upsert(toMessage(stored));
  } catch (error) {
    useMessageStore.getState().setStatus(conversationId, clientId, "failed");
    failed.set(clientId, pending);
    notify(describe(error));
  } finally {
    useUploadStore.getState().set(clientId, null);
  }
}

/** Retries a failed upload. Returns false if the message was not a file upload. */
export function retryUpload(messageId: string): boolean {
  const pending = failed.get(messageId);
  if (!pending) return false;
  void deliver(messageId, pending);
  return true;
}
