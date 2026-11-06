import { useEffect, useState } from "react";
import { useSessionStore } from "@/shared/api/session";
import { addKeyword, blockById, loadModeration, removeKeyword, unblock, useModerationStore } from "../model/moderation";

const isSupervisor = (role: string | null) => role === "SUPERVISOR" || role === "ADMIN";

/** Blocked customers and blocked keywords as the backend holds them (shared by the team, not just this device). */
export default function ModerationLists({ page }: { page: "blocked" | "spam" }) {
  const { blocks, keywords, status } = useModerationStore();
  const supervisor = isSupervisor(useSessionStore((state) => state.role));
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadModeration();
  }, []);

  const canAdd = supervisor;
  const submit = async () => {
    const value = input.trim();
    if (!value || saving) return;
    setSaving(true);
    const ok = page === "blocked" ? await blockById(value) : await addKeyword(value);
    setSaving(false);
    if (ok) setInput("");
  };

  return (
    <>
      <p>
        {page === "blocked"
          ? "Customers who cannot contact you. Block from a conversation's menu; supervisors can also block by customer ID."
          : "A customer message containing one of these words is kept and flagged for review. It is never rejected."}
      </p>
      {status === "loading" && <p className="settings-detail-empty">Loading…</p>}
      {status === "error" && <p className="settings-detail-empty">Could not load the list.</p>}
      {canAdd ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            {page === "blocked" ? "Customer ID" : "Blocked keyword"}
            <input
              required
              maxLength={page === "blocked" ? 36 : 255}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
          <button className="settings-detail-primary" disabled={!input.trim() || saving}>
            {page === "blocked" ? "Block customer" : "Add keyword"}
          </button>
        </form>
      ) : (
        page === "spam" && <p className="settings-detail-hint">Only supervisors can change this list.</p>
      )}
      {page === "blocked" ? (
        <>
          {status === "ready" && blocks.length === 0 && <p className="settings-detail-empty">No blocked customers.</p>}
          {blocks.map((block) => (
            <div className="settings-detail-item" key={block.id}>
              <span>
                {block.customerName ?? block.customerId}
                {block.reason ? ` · ${block.reason}` : ""}
              </span>
              {block.permissions.canUnblock && (
                <button
                  aria-label={`Unblock ${block.customerName ?? block.customerId}`}
                  onClick={() => void unblock(block.customerId)}
                >
                  Unblock
                </button>
              )}
            </div>
          ))}
        </>
      ) : (
        <>
          {status === "ready" && keywords.length === 0 && <p className="settings-detail-empty">No blocked keywords.</p>}
          {keywords.map((item) => (
            <div className="settings-detail-item" key={item.id}>
              <span>{item.keyword}</span>
              {supervisor && (
                <button aria-label={`Remove ${item.keyword}`} onClick={() => void removeKeyword(item.id)}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
}
