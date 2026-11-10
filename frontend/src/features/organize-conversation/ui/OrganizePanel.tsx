import "./organize-panel.css";
import { useEffect, useState } from "react";
import { useConversationStore } from "@/entities/conversation";
import type { Priority } from "@/shared/api/ws";
import { Button, Input } from "@/shared/ui";
import { createTag, loadTagCatalog, setConversationTags, setPriority, useTagCatalog } from "../model/organize";

const PRIORITIES: { id: Priority; label: string; hint: string }[] = [
  { id: "HIGH", label: "High", hint: "Needs attention first" },
  { id: "MEDIUM", label: "Medium", hint: "Normal queue" },
  { id: "LOW", label: "Low", hint: "Can wait" },
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

      <section className="organize-group" aria-labelledby="organize-priority">
        <h4 id="organize-priority">Priority</h4>
        <div className="organize-segmented" role="radiogroup" aria-labelledby="organize-priority">
          {PRIORITIES.map(({ id, label, hint }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={priority === id}
              title={hint}
              data-priority={id}
              disabled={busy}
              onClick={() => {
                if (priority === id) return;
                setBusy(true);
                void setPriority(conversationId, id).finally(() => setBusy(false));
              }}
            >
              <span className="organize-dot" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <p className="organize-hint">{PRIORITIES.find((p) => p.id === priority)?.hint}</p>
      </section>

      <section className="organize-group" aria-labelledby="organize-tags">
        <h4 id="organize-tags">
          Tags{selected.size > 0 && <span className="organize-count">{selected.size} selected</span>}
        </h4>
        {status === "loading" && catalog.length === 0 && <p className="organize-empty">Loading tags…</p>}
        {status === "error" && (
          <p className="organize-empty">
            Could not load the tags.{" "}
            <Button size="xs" variant="outline" onClick={() => void loadTagCatalog()}>
              Try again
            </Button>
          </p>
        )}
        {status === "ready" && catalog.length === 0 && (
          <p className="organize-empty">No tags yet. Create the first one below.</p>
        )}
        {catalog.length > 0 && (
          <div className="organize-tags" role="group" aria-labelledby="organize-tags">
            {catalog.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="organize-chip"
                aria-pressed={selected.has(tag.id)}
                disabled={busy}
                onClick={() => void toggle(tag.id, !selected.has(tag.id))}
              >
                <span className="organize-dot" style={tag.color ? { background: tag.color } : undefined} aria-hidden />
                {tag.name}
              </button>
            ))}
          </div>
        )}
        <form
          className="organize-new"
          onSubmit={(event) => {
            event.preventDefault();
            void addTag();
          }}
        >
          <Input
            value={newTag}
            maxLength={100}
            placeholder="Create a new tag…"
            aria-label="New tag name"
            onChange={(event) => setNewTag(event.target.value)}
          />
          <Button type="submit" disabled={!newTag.trim() || busy}>
            Add
          </Button>
        </form>
      </section>
    </section>
  );
}
