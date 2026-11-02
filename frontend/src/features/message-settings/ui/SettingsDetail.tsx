import { useRef, useState } from "react";
import { useMessageSettingsStore } from "../model/store";
import { notify } from "@/shared/ui";
import "./settings-detail.css";

export type SettingsPage = "training" | "responses" | "blocked" | "spam";
export const pageTitles: Record<SettingsPage, string> = {
  training: "AI training data",
  responses: "Auto-response settings",
  blocked: "Blocked customers",
  spam: "Spam & abuse controls",
};

export default function SettingsDetail({ page, onBack }: { page: SettingsPage; onBack: () => void }) {
  const store = useMessageSettingsStore();
  const [away, setAway] = useState(store.awayMessage);
  const [first, setFirst] = useState(store.firstResponse);
  const [input, setInput] = useState("");
  const [reply, setReply] = useState("");
  const [adding, setAdding] = useState(store.trainingExamples.length === 0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | "Pending" | "Approved">("All");
  const addButton = useRef<HTMLButtonElement>(null);
  const approvedCount = store.trainingExamples.filter((item) => item.approved).length;
  const visibleExamples = store.trainingExamples.filter(
    (item) =>
      (filter === "All" || (filter === "Approved" ? item.approved : !item.approved)) &&
      (item.prompt + " " + item.reply).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const listKey = page === "blocked" ? "blockedCustomers" : "blockedKeywords";
  const list = store[listKey];

  return (
    <div className="settings-detail">
      <div className="settings-detail-toolbar">
        <button className="settings-detail-back" onClick={onBack}>
          ← Message settings
        </button>
        <p className="settings-detail-hint">
          <span aria-hidden="true">✓</span> Saved on this device
        </p>
      </div>
      {page === "responses" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            store.saveResponses(away.trim(), first.trim());
            notify("Auto-response templates saved");
          }}
        >
          <label>
            Away message
            <textarea required maxLength={2000} value={away} onChange={(event) => setAway(event.target.value)} />
          </label>
          <label>
            First-response template
            <textarea required maxLength={2000} value={first} onChange={(event) => setFirst(event.target.value)} />
          </label>
          <button className="settings-detail-primary" disabled={!away.trim() || !first.trim()}>
            Save templates
          </button>
        </form>
      ) : page === "training" ? (
        <>
          <div className="training-intro">
            <span className="training-eyebrow">REPLY LIBRARY</span>
            <h3>Build your team’s reply library</h3>
            <p>Create helpful replies. Review each example before approving it.</p>
          </div>
          <button
            ref={addButton}
            className="training-add-toggle"
            aria-expanded={adding}
            aria-controls="training-example-form"
            onClick={() => setAdding(!adding)}
          >
            <span>
              <span aria-hidden="true">＋</span> New training example
            </span>
            <span aria-hidden="true">{adding ? "−" : "+"}</span>
          </button>
          {adding && (
            <form
              id="training-example-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!input.trim() || !reply.trim()) return;
                store.addExample(input.trim(), reply.trim());
                notify("Example added for review");
                setInput("");
                setReply("");
                setAdding(false);
                setSearch("");
                setFilter("Pending");
                addButton.current?.focus();
              }}
            >
              <label>
                <span className="training-field-title">
                  Customer message <small>{input.length}/2,000</small>
                </span>
                <textarea
                  required
                  value={input}
                  placeholder="e.g. Can I change my repayment date?"
                  maxLength={2000}
                  onChange={(event) => setInput(event.target.value)}
                />
              </label>
              <label>
                <span className="training-field-title">
                  Suggested reply <small>{reply.length}/2,000</small>
                </span>
                <textarea
                  required
                  value={reply}
                  placeholder="Write a clear, helpful response for your team to reuse…"
                  maxLength={2000}
                  onChange={(event) => setReply(event.target.value)}
                />
              </label>
              <button className="settings-detail-primary" disabled={!input.trim() || !reply.trim()}>
                <span aria-hidden="true">＋</span> Add example
              </button>
              <p className="training-form-note">New examples stay pending until you approve them.</p>
            </form>
          )}
          <div className="training-library-heading">
            <h3>
              Training examples <span>{store.trainingExamples.length}</span>
            </h3>
            <small>{store.trainingExamples.filter((item) => item.approved).length} approved</small>
          </div>
          <div className="training-filters" role="group" aria-label="Filter examples">
            {(["All", "Pending", "Approved"] as const).map((value) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {value}{" "}
                <span>
                  {value === "All"
                    ? store.trainingExamples.length
                    : value === "Approved"
                      ? approvedCount
                      : store.trainingExamples.length - approvedCount}
                </span>
              </button>
            ))}
          </div>
          {store.trainingExamples.length > 0 && (
            <input
              className="training-search"
              type="search"
              aria-label="Search training examples"
              placeholder="Search messages or replies…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          {store.trainingExamples.length > 0 && visibleExamples.length === 0 && (
            <div className="training-empty">
              <strong>No matching examples</strong>
              <p>Try another search or filter.</p>
              <button
                onClick={() => {
                  setSearch("");
                  setFilter("All");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
          {!store.trainingExamples.length && (
            <div className="training-empty">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M5 4h14v13H9l-4 4V4Z" />
                <path d="M9 8h6M9 12h4" />
              </svg>
              <strong>Your reply library starts here</strong>
              <p>Add a customer message and a helpful reply to get started.</p>
            </div>
          )}
          {visibleExamples.map((item) => (
            <article className="settings-detail-item" key={item.id}>
              <div className="training-example-heading">
                <span>Customer message</span>
                <span className={`training-badge ${item.approved ? "approved" : ""}`}>
                  {item.approved ? "Approved" : "Pending review"}
                </span>
              </div>
              <strong>{item.prompt}</strong>
              <span className="training-reply-label">Suggested reply</span>
              <p className="training-reply">{item.reply}</p>
              <button aria-pressed={item.approved} onClick={() => store.toggleApproval(item.id)}>
                {item.approved ? "Approved · Undo approval" : "Approve example"}
              </button>
            </article>
          ))}
        </>
      ) : (
        <>
          <p>
            {page === "blocked"
              ? "Manage your local blocked-customer list by name or customer ID."
              : "Manage keywords to flag when reviewing messages."}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const value = input.trim();
              if (!value) return;
              if (list.some((item) => item.toLowerCase() === value.toLowerCase())) {
                notify("Already in the list");
                return;
              }
              store.setList(listKey, [...list, value]);
              setInput("");
            }}
          >
            <label>
              {page === "blocked" ? "Customer name or ID" : "Blocked keyword"}
              <input required maxLength={120} value={input} onChange={(event) => setInput(event.target.value)} />
            </label>
            <button className="settings-detail-primary" disabled={!input.trim()}>
              {page === "blocked" ? "Block customer" : "Add keyword"}
            </button>
          </form>
          {list.length === 0 && (
            <p className="settings-detail-empty">
              {page === "blocked" ? "No blocked customers." : "No blocked keywords."}
            </p>
          )}
          {list.map((item) => (
            <div className="settings-detail-item" key={item}>
              <span>{item}</span>
              <button
                aria-label={`Remove ${item}`}
                onClick={() =>
                  store.setList(
                    listKey,
                    list.filter((value) => value !== item),
                  )
                }
              >
                {page === "blocked" ? "Unblock" : "Remove"}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
