import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/shared/api/session";
import {
  addTrainingExample,
  loadAutomation,
  saveAutoResponses,
  setTrainingApproval,
  useAutomationStore,
} from "../model/automation";
import { useMessageSettingsStore } from "../model/store";
import { notify } from "@/shared/ui";
import { isMockTransport } from "@/shared/api/ws";
import { API_URL } from "@/shared/config";
import ModerationLists, { ListHeading } from "./ModerationLists";
import "./settings-detail.css";

export type SettingsPage = "training" | "responses" | "blocked" | "spam";
export const pageTitles: Record<SettingsPage, string> = {
  training: "AI training data",
  responses: "Auto-response settings",
  blocked: "Blocked customers",
  spam: "Spam & abuse controls",
};

const isSupervisor = (role: string | null) => role === "SUPERVISOR" || role === "ADMIN";

export default function SettingsDetail({ page, onBack }: { page: SettingsPage; onBack: () => void }) {
  const store = useMessageSettingsStore();
  /** Against the real backend the replies and training examples belong to the team and live on the server. */
  const remote = Boolean(API_URL) && !isMockTransport;
  const server = useAutomationStore();
  const canManage = !remote || isSupervisor(useSessionStore((state) => state.role));
  const [away, setAway] = useState(store.awayMessage);
  const [first, setFirst] = useState(store.firstResponse);
  const [saving, setSaving] = useState(false);
  const [input, setInput] = useState("");
  const [reply, setReply] = useState("");
  const [adding, setAdding] = useState(!remote && store.trainingExamples.length === 0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | "Pending" | "Approved">("All");
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (remote && (page === "responses" || page === "training")) void loadAutomation();
  }, [remote, page]);
  useEffect(() => {
    if (!remote || !server.autoResponses) return;
    setAway(server.autoResponses.awayMessage ?? store.awayMessage);
    setFirst(server.autoResponses.firstResponse ?? store.firstResponse);
    // Only when the server's texts arrive; the local defaults are the fallback shown until something is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, server.autoResponses]);
  const examples = remote
    ? server.examples.map((item) => ({
        id: item.id,
        prompt: item.customerMessage,
        reply: item.suggestedReply,
        approved: item.status === "APPROVED",
      }))
    : store.trainingExamples;
  const approvedCount = examples.filter((item) => item.approved).length;
  const visibleExamples = examples.filter(
    (item) =>
      (filter === "All" || (filter === "Approved" ? item.approved : !item.approved)) &&
      (item.prompt + " " + item.reply).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const listKey = page === "blocked" ? "blockedCustomers" : "blockedKeywords";
  const list = store[listKey];
  /** Against the real backend these two lists belong to the team and live on the server. */
  const shared = remote;

  return (
    <div className="settings-detail">
      <div className="settings-detail-toolbar">
        <button className="settings-detail-back" onClick={onBack}>
          ← Message settings
        </button>
        <p className="settings-detail-hint">
          <span aria-hidden="true">✓</span> {shared ? "Shared with your team" : "Saved on this device"}
        </p>
      </div>
      {page === "responses" ? (
        <form
          className="settings-stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!remote) {
              store.saveResponses(away.trim(), first.trim());
              notify("Auto-response templates saved");
              return;
            }
            setSaving(true);
            const ok = await saveAutoResponses({ awayMessage: away.trim(), firstResponse: first.trim() });
            setSaving(false);
            if (ok) notify("Automatic replies saved and switched on");
          }}
        >
          {remote && server.status === "error" && <p className="settings-detail-empty">Could not load the replies.</p>}
          {remote && server.status === "ready" && !server.autoResponses?.firstResponse && (
            <p className="settings-detail-notice">
              {canManage
                ? "Automatic replies are off. Nothing is sent to customers until you save these texts."
                : "Automatic replies are off. A supervisor has not saved them yet."}
            </p>
          )}
          <label>
            First-response template <small>Sent once, when a customer opens a new chat.</small>
            <textarea
              required
              maxLength={2000}
              value={first}
              readOnly={!canManage}
              onChange={(event) => setFirst(event.target.value)}
            />
          </label>
          <label>
            Away message <small>Sent when a customer writes and no agent is available (at most once an hour).</small>
            <textarea
              required
              maxLength={2000}
              value={away}
              readOnly={!canManage}
              onChange={(event) => setAway(event.target.value)}
            />
          </label>
          {canManage ? (
            <button className="settings-detail-primary" disabled={!away.trim() || !first.trim() || saving}>
              {remote ? (saving ? "Saving…" : "Save and turn on") : "Save templates"}
            </button>
          ) : (
            <p className="settings-detail-hint">Only supervisors can change the automatic replies.</p>
          )}
        </form>
      ) : page === "training" ? (
        <>
          <div className="training-intro">
            <span className="training-eyebrow">REPLY LIBRARY</span>
            <h3>Build your team’s reply library</h3>
            <p>
              Create helpful replies. Review each example before approving it.
              {remote && " Approved examples are kept for the AI assistant, which is not switched on yet."}
            </p>
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
              onSubmit={async (event) => {
                event.preventDefault();
                if (!input.trim() || !reply.trim()) return;
                if (remote) {
                  if (!(await addTrainingExample(input.trim(), reply.trim()))) return;
                } else {
                  store.addExample(input.trim(), reply.trim());
                }
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
              Training examples <span>{examples.length}</span>
            </h3>
            <small>{approvedCount} approved</small>
          </div>
          <div className="training-filters" role="group" aria-label="Filter examples">
            {(["All", "Pending", "Approved"] as const).map((value) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {value}{" "}
                <span>
                  {value === "All"
                    ? examples.length
                    : value === "Approved"
                      ? approvedCount
                      : examples.length - approvedCount}
                </span>
              </button>
            ))}
          </div>
          {examples.length > 0 && (
            <input
              className="training-search"
              type="search"
              aria-label="Search training examples"
              placeholder="Search messages or replies…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          {examples.length > 0 && visibleExamples.length === 0 && (
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
          {remote && server.status === "error" && <p className="settings-detail-empty">Could not load the examples.</p>}
          {!examples.length && !(remote && server.status !== "ready") && (
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
              {canManage ? (
                <button
                  aria-pressed={item.approved}
                  onClick={() =>
                    remote ? void setTrainingApproval(item.id, !item.approved) : store.toggleApproval(item.id)
                  }
                >
                  {item.approved ? "Approved · Undo approval" : "Approve example"}
                </button>
              ) : (
                !item.approved && <small className="training-form-note">Waiting for a supervisor to approve.</small>
              )}
            </article>
          ))}
        </>
      ) : shared ? (
        <ModerationLists page={page as "blocked" | "spam"} />
      ) : (
        <>
          <p className="settings-detail-lead">
            {page === "blocked"
              ? "Manage your local blocked-customer list by name or customer ID."
              : "Manage keywords to flag when reviewing messages."}
          </p>
          <form
            className="settings-inline-form"
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
          {list.length > 0 && (
            <ListHeading title={page === "blocked" ? "Blocked customers" : "Blocked keywords"} count={list.length} />
          )}
          {list.map((item) => (
            <div className="settings-detail-item settings-list-row" key={item}>
              <span className="settings-list-text">
                <strong>{item}</strong>
              </span>
              <button
                className="settings-danger-soft"
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
