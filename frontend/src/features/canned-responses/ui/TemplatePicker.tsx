import "./template-picker.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "@/shared/api/session";
import {
  createTemplate,
  deactivateTemplate,
  loadTemplates,
  searchTemplates,
  updateTemplate,
  useTemplatesStore,
  type Template,
} from "../model/store";

const isSupervisor = (role: string | null) => role === "SUPERVISOR" || role === "ADMIN";

type Editing = { id: string | null; title: string; content: string; shortcut: string; shared: boolean };
const BLANK: Editing = { id: null, title: "", content: "", shortcut: "", shared: false };

/**
 * Lists saved replies. Choosing one only hands its text to `onInsert` (the composer); nothing is sent, and the agent
 * can edit the text before sending.
 */
export default function TemplatePicker({ onInsert }: { onInsert: (text: string) => void }) {
  const templates = useTemplatesStore((state) => state.templates);
  const status = useTemplatesStore((state) => state.status);
  const role = useSessionStore((state) => state.role);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && status === "idle") void loadTemplates();
  }, [open, status]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) {
        setOpen(false);
        setEditing(null);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const visible = useMemo(() => searchTemplates(templates, query), [templates, query]);

  const save = async () => {
    if (!editing || !editing.title.trim() || !editing.content.trim()) return;
    const shortcut = editing.shortcut.trim();
    const ok = editing.id
      ? await updateTemplate(editing.id, {
          title: editing.title.trim(),
          content: editing.content.trim(),
          shortcut: shortcut || null,
        })
      : await createTemplate({ title: editing.title, content: editing.content, shortcut, shared: editing.shared });
    if (ok) setEditing(null);
  };

  const edit = (t: Template) =>
    setEditing({
      id: t.id,
      title: t.title,
      content: t.content,
      shortcut: t.shortcut ?? "",
      shared: t.scope === "SHARED",
    });

  return (
    <div className="template-picker" ref={root}>
      <button
        type="button"
        aria-label="Saved replies"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        “ ”
      </button>
      {open && (
        <div className="template-popover" role="dialog" aria-label="Saved replies">
          {editing ? (
            <form
              className="template-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <input
                autoFocus
                value={editing.title}
                maxLength={255}
                placeholder="Title"
                aria-label="Template title"
                onChange={(event) => setEditing({ ...editing, title: event.target.value })}
              />
              <textarea
                value={editing.content}
                maxLength={4000}
                placeholder="Reply text"
                aria-label="Template text"
                onChange={(event) => setEditing({ ...editing, content: event.target.value })}
              />
              <input
                value={editing.shortcut}
                maxLength={50}
                placeholder="Shortcut, like /greeting (optional)"
                aria-label="Template shortcut"
                onChange={(event) => setEditing({ ...editing, shortcut: event.target.value })}
              />
              {!editing.id && isSupervisor(role) && (
                <label>
                  <input
                    type="checkbox"
                    checked={editing.shared}
                    onChange={(event) => setEditing({ ...editing, shared: event.target.checked })}
                  />
                  Share with everyone
                </label>
              )}
              <div className="template-form-actions">
                <button type="submit" disabled={!editing.title.trim() || !editing.content.trim()}>
                  Save
                </button>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <input
                autoFocus
                value={query}
                placeholder="Search saved replies"
                aria-label="Search saved replies"
                onChange={(event) => setQuery(event.target.value)}
              />
              <ul className="template-list">
                {status === "loading" && templates.length === 0 && <li className="template-empty">Loading…</li>}
                {status === "error" && <li className="template-empty">Could not load the saved replies.</li>}
                {status === "ready" && visible.length === 0 && (
                  <li className="template-empty">{templates.length === 0 ? "No saved replies yet." : "No match."}</li>
                )}
                {visible.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="template-choice"
                      onClick={() => {
                        onInsert(t.content);
                        setOpen(false);
                      }}
                    >
                      <strong>
                        {t.title}
                        {t.shortcut && <code>{t.shortcut}</code>}
                        {t.scope === "SHARED" && <small>shared</small>}
                      </strong>
                      <span>{t.content}</span>
                    </button>
                    {t.permissions.canEdit && (
                      <span className="template-item-actions">
                        <button type="button" onClick={() => edit(t)} aria-label={`Edit ${t.title}`}>
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => window.confirm(`Deactivate “${t.title}”?`) && void deactivateTemplate(t.id)}
                          aria-label={`Deactivate ${t.title}`}
                        >
                          Remove
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <button type="button" className="template-new" onClick={() => setEditing(BLANK)}>
                + New saved reply
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
