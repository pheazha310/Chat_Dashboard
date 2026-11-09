import "./callbacks-panel.css";
import { useEffect, useState } from "react";
import type { Callback } from "@/shared/api/rest";
import { cancelCallback, completeCallback, loadCallbacks, scheduleCallback, useCallbackStore } from "../model/store";

const EMPTY: Callback[] = [];
const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A value for <input type="datetime-local" min=…> in this browser's time zone. */
const localInputValue = (date: Date) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
};

function CallbackItem({ callback }: { callback: Callback }) {
  const { permissions } = callback;
  return (
    <article className={`callback-item callback-${callback.status.toLowerCase()}`}>
      <header>
        <strong>{when.format(new Date(callback.scheduledAt))}</strong>
        <span>{callback.status.toLowerCase()}</span>
      </header>
      {callback.notes && <p>{callback.notes}</p>}
      {callback.completionNote && <small>Outcome: {callback.completionNote}</small>}
      {(permissions.canComplete || permissions.canCancel) && (
        <div className="callback-actions">
          {permissions.canComplete && (
            <button
              type="button"
              onClick={() => {
                const note = window.prompt("How did the call go? (optional)");
                if (note !== null) void completeCallback(callback, note);
              }}
            >
              Mark done
            </button>
          )}
          {permissions.canCancel && (
            <button
              type="button"
              onClick={() => window.confirm("Cancel this callback?") && void cancelCallback(callback)}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/** Callbacks of one conversation: schedule one, and finish or cancel the open ones. The server decides who may. */
export default function CallbacksPanel({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const callbacks = useCallbackStore((state) => state.byConversation[conversationId]) ?? EMPTY;
  const status = useCallbackStore((state) => state.status[conversationId]);
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadCallbacks(conversationId);
    setTime("");
    setNotes("");
  }, [conversationId]);

  const submit = async () => {
    if (!time || saving) return;
    setSaving(true);
    const saved = await scheduleCallback(conversationId, time, notes);
    setSaving(false);
    if (saved) {
      setTime("");
      setNotes("");
    }
  };

  const open = callbacks.filter((item) => item.status === "PENDING" || item.status === "MISSED");
  const closed = callbacks.filter((item) => item.status === "COMPLETED" || item.status === "CANCELLED");

  return (
    <section className="context-detail-panel callbacks-panel">
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
          <h3>Callbacks</h3>
          <p>Reminders arrive shortly before the time you choose</p>
        </div>
      </header>

      <form
        className="callback-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          Call back at
          <input
            type="datetime-local"
            value={time}
            min={localInputValue(new Date())}
            onChange={(event) => setTime(event.target.value)}
            required
          />
        </label>
        <textarea
          value={notes}
          maxLength={2000}
          placeholder="Note for the call (optional, staff only)"
          aria-label="Callback note"
          onChange={(event) => setNotes(event.target.value)}
        />
        <button type="submit" disabled={!time || saving}>
          Schedule callback
        </button>
      </form>

      <div className="callback-list">
        {status === "loading" && callbacks.length === 0 && <p className="empty-files">Loading callbacks…</p>}
        {status === "error" && <p className="empty-files">Could not load the callbacks.</p>}
        {status === "ready" && callbacks.length === 0 && <p className="empty-files">No callbacks scheduled.</p>}
        {open.map((callback) => (
          <CallbackItem key={callback.id} callback={callback} />
        ))}
        {closed.length > 0 && <h4>Earlier</h4>}
        {closed.map((callback) => (
          <CallbackItem key={callback.id} callback={callback} />
        ))}
      </div>
    </section>
  );
}
