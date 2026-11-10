import { create } from "zustand";
import { useMessageStore } from "@/entities/message";
import { ApiError, uploadFileRequest, uploadVoiceRequest } from "@/shared/api/rest";
import { toMessage } from "@/shared/api/backend/mappers";
import { API_URL } from "@/shared/config";
import { notify } from "@/shared/ui";
import { sendMessage as mockSend, useComposerStore } from "./store";

/** Types the server accepts (docs/api-attachments.md); the server checks the content too. */
export const ACCEPTED_FILES =
  ".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.mp3,.ogg,.wav,.m4a,.mp4,.webm,.mov";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** At most this many files wait in the composer at once. */
export const MAX_CHOSEN_FILES = 10;

/** Upload progress (0 to 1) by message client id, for the progress bar shown while files are on their way. */
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

/** What a file is, for its preview and its size limit. */
export type FileKind = "image" | "pdf" | "word" | "sheet" | "text" | "audio" | "video";

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  pdf: "pdf",
  doc: "word",
  docx: "word",
  xls: "sheet",
  xlsx: "sheet",
  csv: "sheet",
  txt: "text",
  mp3: "audio",
  ogg: "audio",
  wav: "audio",
  m4a: "audio",
  mp4: "video",
  webm: "video",
  mov: "video",
};

export const extensionOf = (name: string) => (name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "");

/** The kind of a file by its extension, or null when the server would refuse it. */
export const fileKind = (name: string): FileKind | null => KIND_BY_EXTENSION[extensionOf(name)] ?? null;

/** 1536 → "1.5 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why a file cannot be sent, or null when it can. */
export function fileProblem(file: File): string | null {
  const kind = fileKind(file.name);
  if (!kind) return `${file.name}: this file type is not supported`;
  if (file.size === 0) return `${file.name} is empty`;
  const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (file.size > limit)
    return `${file.name} is too large (${formatFileSize(file.size)}); the limit is ${formatFileSize(limit)}`;
  return null;
}

/** A file waiting in the composer. `previewUrl` is a local object URL for images. */
export type ChosenFile = { id: string; file: File; kind: FileKind; previewUrl?: string };

/** The files chosen for each conversation, waiting for the agent to press send. */
export const useChosenFilesStore = create<{ files: Record<string, ChosenFile[]> }>(() => ({ files: {} }));

const EMPTY: ChosenFile[] = [];
export const useChosenFiles = (conversationId: string) =>
  useChosenFilesStore((state) => state.files[conversationId] ?? EMPTY);

const chosenOf = (conversationId: string) => useChosenFilesStore.getState().files[conversationId] ?? EMPTY;
const setChosen = (conversationId: string, files: ChosenFile[]) => {
  useChosenFilesStore.setState((state) => ({ files: { ...state.files, [conversationId]: files } }));
  useComposerStore.getState().setAttachment(conversationId, files.map((f) => f.file.name).join(", "));
};
const preview = (file: File, kind: FileKind) =>
  kind === "image" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : undefined;
const release = (chosen: ChosenFile) => {
  if (chosen.previewUrl && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(chosen.previewUrl);
};

type Pending = { conversationId: string; file: File; text: string; voice?: { durationMs: number } };
/** Uploads that failed, kept so "Retry" can send the same file again with the same client id. */
const failed = new Map<string, Pending>();

export const hasChosenFile = (conversationId: string) => chosenOf(conversationId).length > 0;

/**
 * Adds files (from the picker, a drop or a paste) to the next send. Files that cannot be sent are skipped and their
 * problems returned; the same file twice is kept once.
 */
export function chooseFiles(conversationId: string, files: readonly File[]): string[] {
  const problems: string[] = [];
  const next = [...chosenOf(conversationId)];
  for (const file of files) {
    const problem = fileProblem(file);
    if (problem) {
      problems.push(problem);
      continue;
    }
    if (next.some((c) => c.file.name === file.name && c.file.size === file.size)) continue;
    if (next.length >= MAX_CHOSEN_FILES) {
      problems.push(`At most ${MAX_CHOSEN_FILES} files at a time`);
      break;
    }
    const kind = fileKind(file.name) as FileKind;
    const previewUrl = preview(file, kind);
    next.push({ id: crypto.randomUUID(), file, kind, ...(previewUrl ? { previewUrl } : {}) });
  }
  setChosen(conversationId, next);
  return problems;
}

/** One file, for callers that pick a single file. Returns the problem, or null when it was added. */
export const chooseFile = (conversationId: string, file: File): string | null =>
  chooseFiles(conversationId, [file])[0] ?? null;

export function removeChosenFile(conversationId: string, id: string) {
  const files = chosenOf(conversationId);
  files.filter((f) => f.id === id).forEach(release);
  setChosen(
    conversationId,
    files.filter((f) => f.id !== id),
  );
}

export function clearChosenFile(conversationId: string) {
  chosenOf(conversationId).forEach(release);
  setChosen(conversationId, []);
}

const describe = (error: unknown) =>
  error instanceof ApiError || error instanceof Error ? error.message : "The file could not be sent";

/**
 * Sends the chosen files, one message each, with the draft as the caption of the first. Each message shows at once as
 * "sending" and fills in when the server answers. Without a backend (mock mode) each file is sent as a text message.
 * Returns how many files were sent.
 */
export function sendChosenFiles(conversationId: string): number {
  const files = chosenOf(conversationId);
  if (files.length === 0) return 0;
  const caption = useComposerStore.getState().drafts[conversationId]?.trim() ?? "";
  clearChosenFile(conversationId);
  const composer = useComposerStore.getState();
  composer.setDraft(conversationId, "");
  files.forEach(({ file }, index) => {
    const text = index === 0 ? caption : "";
    if (!API_URL) {
      sendMockFile(conversationId, file, text);
      return;
    }
    void deliver(`c-${crypto.randomUUID()}`, { conversationId, file, text });
  });
  return files.length;
}

/** The mock server has no uploads: the file is shown as a text message naming it. */
function sendMockFile(conversationId: string, file: File, caption: string) {
  const line = `📎 ${file.name} (${formatFileSize(file.size)})`;
  mockSend(conversationId, caption ? `${caption}\n${line}` : line);
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
