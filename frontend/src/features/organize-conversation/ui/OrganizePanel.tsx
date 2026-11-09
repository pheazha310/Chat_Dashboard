import "./organize-panel.css";
import { useEffect, useState } from "react";
import { useConversationStore } from "@/entities/conversation";
import type { Priority } from "@/shared/api/ws";
import { createTag, loadTagCatalog, setConversationTags, setPriority, useTagCatalog } from "../model/organize";

const PRIORITIES: { id: Priority; label: string }[] = [
  { id: "HIGH", label: "High" },
  { id: "MEDIUM", label: "Medium" },
  { id: "LOW", label: "Low" },
];

/** Priority and tags of one conversation. The server decides who may change them and answers with the new state. */
export default function OrganizePanel({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const conversation = useConversationStore((state) => state.byId[conversationId]);
  const catalog = useTagCatalog((state) => state.tags);
  const status = useTagCatalog((state) => state.status);
  const [newTag, setNewTag] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadTagCatalog();
  }, []);

  if (!conversation) return null;
  const priority = conversation.priority ?? (conversation.urgent ? "HIGH" : "MEDIUM");
  const selected = new Set((conversation.tags ?? []).map((tag) => tag.id));

  const toggle = async (tagId: string, on: boolean) => {
    const next = on ? [...selected, tagId] : [...selected].filter((id) => id !== tagId);
    setBusy(true);
    await setConversationTags(conversationId, next);
    setBusy(false);
  };

  const addTag = async () => {
    if (!newTag.trim() || busy) return;
    setBusy(true);
    const created = await createTag(newTag);
    if (created) {
      setNewTag("");
      await setConversationTags(conversationId, [...selected, created.id]);
    }
    setBusy(false);
  };

  return (
    <section className="context-detail-panel organize-panel">
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
          <h3>Priority & tags</h3>
          <p>{conversation.name}</p>
        </div>
      </header>

      <fieldset className="organize-group">
        <legend>Priority</legend>
        {PRIORITIES.map(({ id, label }) => (
          <label key={id}>
            <input
              type="radio"
              name={`priority-${conversationId}`}
              checked={priority === id}
              disabled={busy}
              onChange={() => {
                setBusy(true);
                void setPriority(conversationId, id).finally(() => setBusy(false));
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="organize-group">
        <legend>Tags</legend>
        {status === "loading" && catalog.length === 0 && <p className="empty-files">Loading tags…</p>}
        {status === "error" && <p className="empty-files">Could not load the tags.</p>}
        {status === "ready" && catalog.length === 0 && (
          <p className="empty-files">No tags yet. Create the first one below.</p>
        )}
        {catalog.map((tag) => (
          <label key={tag.id}>
            <input
              type="checkbox"
              checked={selected.has(tag.id)}
              disabled={busy}
              onChange={(event) => void toggle(tag.id, event.target.checked)}
            />
            <span className="organize-dot" style={tag.color ? { background: tag.color } : undefined} aria-hidden />
            {tag.name}
          </label>
        ))}
        <form
          className="organize-new"
          onSubmit={(event) => {
            event.preventDefault();
            void addTag();
          }}
        >
          <input
            value={newTag}
            maxLength={100}
            placeholder="New tag"
            aria-label="New tag name"
            onChange={(event) => setNewTag(event.target.value)}
          />
          <button type="submit" disabled={!newTag.trim() || busy}>
            Add
          </button>
        </form>
      </fieldset>
    </section>
  );
}
