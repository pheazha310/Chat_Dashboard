import { useState } from "react";
import { assets } from "@/shared/config";
import { AssetIcon, notify } from "@/shared/ui";
import { usePrivacyStore } from "../model/store";

export default function PrivacyPanel({ reference, onBack }: { reference: string; onBack: () => void }) {
  const { readReceipts, secureUploads, setReadReceipts, setSecureUploads } = usePrivacyStore();
  const [supportDraft, setSupportDraft] = useState("");

  return (
    <section className="context-detail-panel">
      <header className="detail-panel-header">
        <button onClick={onBack} aria-label="Back to customer details">
          ←
        </button>
        <div>
          <h3>Privacy & support</h3>
          <p>Conversation controls</p>
        </div>
      </header>
      <div className="security-banner">
        <span>
          <AssetIcon src={assets.icons.shield} size={22} />
        </span>
        <div>
          <strong>Secure conversation</strong>
          <p>Messages and files are encrypted in transit and at rest.</p>
        </div>
      </div>
      <section className="privacy-section">
        <h4>Privacy controls</h4>
        <label className="setting-row">
          <div>
            <strong>Read receipts</strong>
            <small>Show when agent messages are read</small>
          </div>
          <input
            type="checkbox"
            checked={readReceipts}
            onChange={(event) => {
              setReadReceipts(event.target.checked);
              notify(`Read receipts ${event.target.checked ? "enabled" : "disabled"}`);
            }}
          />
        </label>
        <label className="setting-row">
          <div>
            <strong>Secure file uploads</strong>
            <small>Scan new files before sharing</small>
          </div>
          <input
            type="checkbox"
            checked={secureUploads}
            onChange={(event) => {
              setSecureUploads(event.target.checked);
              notify(`Secure uploads ${event.target.checked ? "enabled" : "disabled"}`);
            }}
          />
        </label>
      </section>
      <section className="privacy-section">
        <h4>Conversation reference</h4>
        <button
          className="reference-copy"
          onClick={() => {
            navigator.clipboard?.writeText(reference);
            notify("Conversation reference copied");
          }}
        >
          <span>{reference}</span>
          <strong>Copy</strong>
        </button>
      </section>
      <form
        className="support-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!supportDraft.trim()) return;
          setSupportDraft("");
          notify("Support request submitted");
        }}
      >
        <h4>Contact support</h4>
        <p>Report a technical or account issue to the operations team.</p>
        <textarea
          value={supportDraft}
          onChange={(event) => setSupportDraft(event.target.value)}
          placeholder="Describe the issue..."
        />
        <button type="submit" disabled={!supportDraft.trim()}>
          Submit support request
        </button>
      </form>
    </section>
  );
}
