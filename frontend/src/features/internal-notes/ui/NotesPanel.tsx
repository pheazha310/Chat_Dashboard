import "./notes-panel.css";
import { useEffect, useState } from "react";
import { useConversationStore } from "@/entities/conversation";
import { useSessionStore } from "@/shared/api/session";
import { formatClock } from "@/shared/lib/format-time";
import { addNote, deleteNote, editNote, loadNotes, useConversationNotes, useNotesStore } from "../model/store";
import type { NoteDto } from "@/shared/api/ws";

const isSupervisor = (role: string | null) => role === "SUPERVISOR" || role === "ADMIN";

function NoteItem({ note, names }: { note: NoteDto; names: Map<string, string> }) {
  const me = useSessionStore((state) => state.userId);
  const role = useSessionStore((state) => state.role);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const canEdit = note.authorId === me;
  const canDelete = canEdit || isSupervisor(role);

  return (
    <article className="internal-note">
      <header>
        <strong>{note.authorId === me ? "You" : (note.authorName ?? names.get(note.authorId) ?? "Agent")}</strong>
        <time>
          {formatClock(note.createdAt)}
          {note.edited ? " · edited" : ""}
        </time>
      </header>
      {editing ? (
        <>
          <textarea value={text} aria-label="Edit note" onChange={(event) => setText(event.target.value)} />
          <div className="internal-note-actions">
            <button
              type="button"
              onClick={() => void editNote(note, text).then((ok) => ok && setEditing(false))}
              disabled={!text.trim()}
            >
              Save
            </button>
            <button type="button" onClick={() => (setText(note.text), setEditing(false))}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{note.text}</p>
          {note.mentionedAgentIds.length > 0 && (
            <small>Mentioned: {note.mentionedAgentIds.map((id) => names.get(id) ?? "an agent").join(", ")}</small>
          )}
          {(canEdit || canDelete) && (
            <div className="internal-note-actions">
              {canEdit && (
                <button type="button" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
              {canDelete && (
                <button type="button" onClick={() => window.confirm("Delete this note?") && void deleteNote(note)}>
                  Delete
                </button>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}

/** Staff-only notes of one conversation, with agent mentions. Customers never see them. */
export default function NotesPanel({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const notes = useConversationNotes(conversationId);
  const status = useNotesStore((state) => state.status[conversationId]);
  const conversations = useConversationStore((state) => state.byId);
  const me = useSessionStore((state) => state.userId);
  const [text, setText] = useState("");
  const [mentioned, setMentioned] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadNotes(conversationId);
    setText("");
    setMentioned([]);
  }, [conversationId]);

  // The directory has no "list agents" call yet, so the choices are the agents this dashboard already knows about.
  const names = new Map<string, string>();
  for (const conversation of Object.values(conversations)) {
    if (conversation.assignedAgent) names.set(conversation.assignedAgent.id, conversation.assignedAgent.name);
  }
  const choices = [...names].filter(([id]) => id !== me);

  const submit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    const saved = await addNote(conversationId, text, mentioned);
    setSaving(false);
    if (saved) {
      setText("");
      setMentioned([]);
    }
  };

  return (
    <section className="context-detail-panel internal-notes">
      <header className="detail-panel-header">
        <button
          className="media-back-button"
          type="button"
          onClick={onBack}
          aria-label="Back to customer details"
          autoFocus
        >
          ‹
        </button>
        <div>
          <h3>Internal notes</h3>
          <p>Only staff can see these</p>
        </div>
      </header>

      <form
        className="internal-note-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          value={text}
          aria-label="New internal note"
          placeholder="Write a note for your team…"
          maxLength={4000}
          onChange={(event) => setText(event.target.value)}
        />
        {choices.length > 0 && (
          <fieldset>
            <legend>Notify</legend>
            {choices.map(([id, name]) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={mentioned.includes(id)}
                  onChange={(event) =>
                    setMentioned(event.target.checked ? [...mentioned, id] : mentioned.filter((m) => m !== id))
                  }
                />
                {name}
              </label>
            ))}
          </fieldset>
        )}
        <button type="submit" disabled={!text.trim() || saving}>
          {saving ? "Saving…" : "Add note"}
        </button>
      </form>

      <div className="internal-note-list">
        {status === "loading" && notes.length === 0 && <p className="empty-files">Loading notes…</p>}
        {status === "error" && <p className="empty-files">Could not load the notes.</p>}
        {status === "ready" && notes.length === 0 && <p className="empty-files">No notes yet.</p>}
        {notes.map((note) => (
          <NoteItem key={note.id} note={note} names={names} />
        ))}
      </div>
    </section>
  );
}
