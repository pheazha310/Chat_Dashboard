import "./notes-panel.css";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useConversationStore } from "@/entities/conversation";
import { useSessionStore } from "@/shared/api/session";
import { avatarFor } from "@/shared/lib/avatar";
import { formatClock, formatListTime } from "@/shared/lib/format-time";
import { Button, confirmAction } from "@/shared/ui";
import { addNote, deleteNote, editNote, loadNotes, useConversationNotes, useNotesStore } from "../model/store";
import type { NoteDto } from "@/shared/api/ws";

const MAX_LENGTH = 4000;
const isSupervisor = (role: string | null) => role === "SUPERVISOR" || role === "ADMIN";
/** Ctrl/⌘ + Enter submits, as in most chat tools; plain Enter keeps adding lines. */
const isSubmitKey = (event: KeyboardEvent) => event.key === "Enter" && (event.metaKey || event.ctrlKey);

function NoteItem({ note, names }: { note: NoteDto; names: Map<string, string> }) {
  const me = useSessionStore((state) => state.userId);
  const role = useSessionStore((state) => state.role);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const canEdit = note.authorId === me;
  const canDelete = canEdit || isSupervisor(role);
  const author = note.authorName ?? names.get(note.authorId) ?? "Agent";

  const save = () => {
    if (text.trim()) void editNote(note, text).then((ok) => ok && setEditing(false));
  };
  const cancel = () => {
    setText(note.text);
    setEditing(false);
  };

  return (
    <article className="internal-note">
      <img className="internal-note-avatar" src={avatarFor(author)} alt="" />
      <div className="internal-note-body">
        <header>
          <strong>{canEdit ? "You" : author}</strong>
          <time dateTime={note.createdAt} title={new Date(note.createdAt).toLocaleString()}>
            {formatListTime(note.createdAt)}
            {formatListTime(note.createdAt) !== formatClock(note.createdAt) && ` · ${formatClock(note.createdAt)}`}
          </time>
          {note.edited && <span className="internal-note-edited">edited</span>}
        </header>
        {editing ? (
          <>
            <textarea
              value={text}
              aria-label="Edit note"
              maxLength={MAX_LENGTH}
              autoFocus
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (isSubmitKey(event)) save();
                if (event.key === "Escape") cancel();
              }}
            />
            <div className="internal-note-actions">
              <Button size="sm" onClick={save} disabled={!text.trim()}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>{note.text}</p>
            {note.mentionedAgentIds.length > 0 && (
              <ul className="internal-note-mentions" aria-label="Notified">
                {note.mentionedAgentIds.map((id) => (
                  <li key={id}>@{names.get(id) ?? "agent"}</li>
                ))}
              </ul>
            )}
            {(canEdit || canDelete) && (
              <div className="internal-note-actions internal-note-actions-hover">
                {canEdit && (
                  <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="internal-note-delete"
                    onClick={() =>
                      void confirmAction({
                        title: "Delete this note?",
                        description: "Your team will no longer see it. This cannot be undone.",
                        confirmLabel: "Delete",
                      }).then((ok) => {
                        if (ok) void deleteNote(note);
                      })
                    }
                  >
                    Delete
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
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
  const canSubmit = text.trim() !== "" && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const saved = await addNote(conversationId, text, mentioned);
    setSaving(false);
    if (saved) {
      setText("");
      setMentioned([]);
    }
  };

  const toggleMention = (id: string) =>
    setMentioned((current) => (current.includes(id) ? current.filter((m) => m !== id) : [...current, id]));

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
        className="internal-note-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          value={text}
          aria-label="New internal note"
          placeholder="Write a note for your team…"
          maxLength={MAX_LENGTH}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (isSubmitKey(event)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {choices.length > 0 && (
          <div className="internal-note-notify" role="group" aria-label="Notify teammates">
            <span>Notify</span>
            {choices.map(([id, name]) => (
              <button
                key={id}
                type="button"
                className="internal-note-chip"
                aria-pressed={mentioned.includes(id)}
                onClick={() => toggleMention(id)}
              >
                <img src={avatarFor(name)} alt="" />
                {name}
              </button>
            ))}
          </div>
        )}
        <footer>
          <span className="internal-note-hint">
            {text.length > MAX_LENGTH * 0.9 ? `${MAX_LENGTH - text.length} characters left` : "Ctrl + Enter to add"}
          </span>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {saving ? "Saving…" : "Add note"}
          </Button>
        </footer>
      </form>

      <div className="internal-note-list">
        {notes.length > 0 && (
          <h4 className="internal-note-count">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </h4>
        )}
        {status === "loading" && notes.length === 0 && <p className="internal-note-empty">Loading notes…</p>}
        {status === "error" && (
          <div className="internal-note-empty">
            <p>Could not load the notes.</p>
            <Button size="sm" variant="outline" onClick={() => void loadNotes(conversationId)}>
              Try again
            </Button>
          </div>
        )}
        {status === "ready" && notes.length === 0 && (
          <div className="internal-note-empty">
            <span className="internal-note-empty-icon" aria-hidden="true">
              🗒
            </span>
            <strong>No notes yet</strong>
            <p>Leave context for teammates who pick up this conversation. The customer never sees notes.</p>
          </div>
        )}
        {notes.map((note) => (
          <NoteItem key={note.id} note={note} names={names} />
        ))}
      </div>
    </section>
  );
}
