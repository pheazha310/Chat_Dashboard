import { create } from "zustand";
import { createNoteRequest, deleteNoteRequest, listNotes, updateNoteRequest } from "@/shared/api/rest";
import { toNote } from "@/shared/api/backend/mappers";
import type { NoteDto } from "@/shared/api/ws";
import { notify } from "@/shared/ui";

type NotesState = {
  byConversation: Record<string, NoteDto[]>;
  status: Record<string, "loading" | "ready" | "error" | undefined>;
  setNotes: (conversationId: string, notes: NoteDto[]) => void;
  upsert: (note: NoteDto) => void;
  remove: (conversationId: string, noteId: string) => void;
  setStatus: (conversationId: string, status: "loading" | "ready" | "error") => void;
};

const EMPTY: NoteDto[] = [];
const newestFirst = (a: NoteDto, b: NoteDto) => b.createdAt.localeCompare(a.createdAt);

export const useNotesStore = create<NotesState>((set) => ({
  byConversation: {},
  status: {},
  setNotes: (conversationId, notes) =>
    set((state) => ({ byConversation: { ...state.byConversation, [conversationId]: [...notes].sort(newestFirst) } })),
  upsert: (note) =>
    set((state) => {
      const list = state.byConversation[note.conversationId] ?? EMPTY;
      const next = list.some((n) => n.id === note.id)
        ? list.map((n) => (n.id === note.id ? note : n))
        : [...list, note];
      return { byConversation: { ...state.byConversation, [note.conversationId]: next.sort(newestFirst) } };
    }),
  remove: (conversationId, noteId) =>
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: (state.byConversation[conversationId] ?? EMPTY).filter((n) => n.id !== noteId),
      },
    })),
  setStatus: (conversationId, status) => set((state) => ({ status: { ...state.status, [conversationId]: status } })),
}));

export const useConversationNotes = (conversationId: string) =>
  useNotesStore((state) => state.byConversation[conversationId] ?? EMPTY);

const failure = (error: unknown, fallback: string) => notify(error instanceof Error ? error.message : fallback);

export async function loadNotes(conversationId: string) {
  const store = useNotesStore.getState();
  store.setStatus(conversationId, "loading");
  try {
    store.setNotes(conversationId, (await listNotes(conversationId)).map(toNote));
    store.setStatus(conversationId, "ready");
  } catch {
    store.setStatus(conversationId, "error");
  }
}

/** Returns true when the note was saved, so the form can clear itself. */
export async function addNote(conversationId: string, text: string, mentionedAgentIds: string[]) {
  try {
    useNotesStore.getState().upsert(toNote(await createNoteRequest(conversationId, text.trim(), mentionedAgentIds)));
    return true;
  } catch (error) {
    failure(error, "Could not save the note");
    return false;
  }
}

export async function editNote(note: NoteDto, text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed === note.text) return true;
  try {
    useNotesStore.getState().upsert(toNote(await updateNoteRequest(note.id, { text: trimmed })));
    return true;
  } catch (error) {
    failure(error, "Could not edit the note");
    return false;
  }
}

export async function deleteNote(note: NoteDto) {
  try {
    await deleteNoteRequest(note.id);
    useNotesStore.getState().remove(note.conversationId, note.id);
  } catch (error) {
    failure(error, "Could not delete the note");
  }
}
