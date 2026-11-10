import "./callbacks-panel.css";
import { useEffect, useState } from "react";
import type { Callback } from "@/shared/api/rest";
import { confirmAction, promptAction } from "@/shared/ui";
import { cancelCallback, completeCallback, loadCallbacks, scheduleCallback, useCallbackStore } from "../model/store";

const EMPTY: Callback[] = [];
const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A value for <input type="datetime-local" min=…> in this browser's time zone. */
const localInputValue = (date: Date) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
};

/** Quick picks, computed when the panel renders so "in 1 hour" is never stale for long. */
const quickPicks = (): { label: string; date: Date }[] => {
  const now = new Date();
  const at9 = (daysAhead: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { label: "In 1 hour", date: new Date(now.getTime() + 60 * 60_000) },
    { label: "Tomorrow 9:00", date: at9(1) },
    { label: "Next Monday 9:00", date: at9(toMonday) },
  ];
};

function CallbackItem({ callback }: { callback: Callback }) {
  const { permissions } = callback;
  const overdue = callback.status === "PENDING" && new Date(callback.scheduledAt).getTime() < Date.now();
  return (
    <article className={`callback-item callback-${callback.status.toLowerCase()}`}>
      <header>
        <strong>{when.format(new Date(callback.scheduledAt))}</strong>
        <span className="callback-badge">{overdue ? "overdue" : callback.status.toLowerCase()}</span>
      </header>
      {callback.notes && <p>{callback.notes}</p>}
      {callback.completionNote && (
        <small>
          <b>Outcome:</b> {callback.completionNote}
        </small>
      )}
      {(permissions.canComplete || permissions.canCancel) && (
        <div className="callback-actions">
          {permissions.canComplete && (
            <button
              type="button"
              className="callback-primary"
              onClick={() =>
                void promptAction({
                  title: "Mark callback as done",
                  inputLabel: "How did the call go?",
                  placeholder: "e.g. Customer confirmed the new payment date",
                  confirmLabel: "Mark done",
                }).then((note) => {
                  if (note !== null) void completeCallback(callback, note);
                })
              }
            >
              Mark done
            </button>
          )}
          {permissions.canCancel && (
            <button
              type="button"
              onClick={() =>
                void confirmAction({
                  title: "Cancel this callback?",
                  confirmLabel: "Cancel callback",
                  cancelLabel: "Keep",
                }).then((ok) => {
                  if (ok) void cancelCallback(callback);
                })
              }
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
        <label htmlFor="callback-time">Call back at</label>
        <div className="callback-quick" role="group" aria-label="Quick times">
          {quickPicks().map(({ label, date }) => {
            const value = localInputValue(date);
            return (
              <button
                key={label}
                type="button"
                className="callback-chip"
                aria-pressed={time === value}
                onClick={() => setTime(value)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <input
          id="callback-time"
          type="datetime-local"
          value={time}
          min={localInputValue(new Date())}
          onChange={(event) => setTime(event.target.value)}
          required
        />
        <label htmlFor="callback-note">
          Note <span className="callback-hint">optional, staff only</span>
        </label>
        <textarea
          id="callback-note"
          value={notes}
          maxLength={2000}
          placeholder="What should be discussed on the call?"
          onChange={(event) => setNotes(event.target.value)}
        />
        {notes.length > 1500 && <span className="callback-count">{notes.length}/2000</span>}
        <button type="submit" disabled={!time || saving}>
          {saving ? "Scheduling…" : time ? `Schedule for ${when.format(new Date(time))}` : "Pick a time to schedule"}
        </button>
      </form>

      <div className="callback-list">
        {status === "loading" && callbacks.length === 0 && <p className="empty-files">Loading callbacks…</p>}
        {status === "error" && <p className="empty-files">Could not load the callbacks.</p>}
        {status === "ready" && callbacks.length === 0 && (
          <div className="callback-empty">
            <strong>No callbacks yet</strong>
            <span>Schedule one above and you will be reminded before it is due.</span>
          </div>
        )}
        {open.length > 0 && <h4>Upcoming</h4>}
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
