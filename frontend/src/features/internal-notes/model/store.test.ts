import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  listNotes: vi.fn(),
  createNoteRequest: vi.fn(),
  updateNoteRequest: vi.fn(),
  deleteNoteRequest: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/ui", () => ({ notify }));

import type { NoteDto } from "@/shared/api/ws";
import { addNote, deleteNote, editNote, loadNotes, useNotesStore } from "./store";

const backend = (id: string, createdAt: string, patch = {}) => ({
  id,
  conversationId: "a",
  authorAgentId: "me",
  author: { id: "me", name: "Sarah", avatarUrl: null },
  content: `note ${id}`,
  mentionedAgentIds: [],
  isEdited: false,
  createdAt,
  ...patch,
});
const note = (id: string, patch: Partial<NoteDto> = {}): NoteDto => ({
  id,
  conversationId: "a",
  authorId: "me",
  text: `note ${id}`,
  mentionedAgentIds: [],
  edited: false,
  createdAt: "2026-01-01T09:00:00Z",
  ...patch,
});
const held = () => useNotesStore.getState().byConversation.a ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  useNotesStore.setState({ byConversation: {}, status: {} });
});

describe("loading", () => {
  it("loads notes newest first and marks the conversation ready", async () => {
    rest.listNotes.mockResolvedValue([backend("n1", "2026-01-01T09:00:00Z"), backend("n2", "2026-01-01T10:00:00Z")]);
    await loadNotes("a");
    expect(held().map((n) => n.id)).toEqual(["n2", "n1"]);
    expect(held()[0]).toMatchObject({ authorId: "me", authorName: "Sarah", text: "note n2" });
    expect(useNotesStore.getState().status.a).toBe("ready");
  });

  it("flags a failed load without losing what is held", async () => {
    useNotesStore.getState().upsert(note("n1"));
    rest.listNotes.mockRejectedValue(new Error("offline"));
    await loadNotes("a");
    expect(useNotesStore.getState().status.a).toBe("error");
    expect(held()).toHaveLength(1);
  });
});

describe("live updates", () => {
  it("adds, replaces and removes without duplicating", () => {
    const store = useNotesStore.getState();
    store.upsert(note("n1"));
    store.upsert(note("n1", { text: "changed", edited: true }));
    store.upsert(note("n2", { createdAt: "2026-01-01T10:00:00Z" }));
    expect(held().map((n) => [n.id, n.text])).toEqual([
      ["n2", "note n2"],
      ["n1", "changed"],
    ]);
    store.remove("a", "n2");
    expect(held().map((n) => n.id)).toEqual(["n1"]);
  });
});

describe("actions", () => {
  it("saves a note with its mentions and holds the server copy", async () => {
    rest.createNoteRequest.mockResolvedValue(backend("n1", "2026-01-01T09:00:00Z", { mentionedAgentIds: ["x"] }));
    await expect(addNote("a", "  call back ", ["x"])).resolves.toBe(true);
    expect(rest.createNoteRequest).toHaveBeenCalledWith("a", "call back", ["x"]);
    expect(held()[0]).toMatchObject({ id: "n1", mentionedAgentIds: ["x"] });
  });

  it("reports why a note was refused and keeps the form", async () => {
    rest.createNoteRequest.mockRejectedValue(new Error("Some mentioned agents cannot see this conversation"));
    await expect(addNote("a", "x", ["y"])).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith("Some mentioned agents cannot see this conversation");
    expect(held()).toEqual([]);
  });

  it("edits only when the text changed, and removes a note only after the server confirms", async () => {
    useNotesStore.getState().upsert(note("n1"));
    await expect(editNote(note("n1"), "note n1")).resolves.toBe(true);
    await expect(editNote(note("n1"), "   ")).resolves.toBe(true);
    expect(rest.updateNoteRequest).not.toHaveBeenCalled();
    rest.updateNoteRequest.mockResolvedValue(backend("n1", "2026-01-01T09:00:00Z", { content: "new", isEdited: true }));
    await editNote(note("n1"), "new");
    expect(held()[0]).toMatchObject({ text: "new", edited: true });

    rest.deleteNoteRequest.mockRejectedValueOnce(new Error("no"));
    await deleteNote(note("n1"));
    expect(held()).toHaveLength(1);
    rest.deleteNoteRequest.mockResolvedValueOnce({});
    await deleteNote(note("n1"));
    expect(held()).toHaveLength(0);
  });
});
