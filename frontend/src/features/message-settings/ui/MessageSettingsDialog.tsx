import { useEffect, useRef } from "react";
import { assets } from "@/shared/config";
import { notify } from "@/shared/ui";
import { useMessageSettingsStore } from "../model/store";
import SettingsRow from "./SettingsRow";

export default function MessageSettingsDialog() {
  const { open, values, setOpen, toggle } = useMessageSettingsStore();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="settings-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
    >
      <section className="message-settings" role="dialog" aria-modal="true" aria-labelledby="message-settings-title">
        <header>
          <h2 id="message-settings-title">Message setting</h2>
          <button ref={closeRef} onClick={() => setOpen(false)} aria-label="Close message settings">
            ×
          </button>
        </header>
        <div className="settings-content">
          <div className="settings-card">
            <SettingsRow
              icon={assets.settings.phone}
              title="New conversation alerts"
              description="Notify me when a customer starts a new chat."
              enabled={values.conversationAlerts}
              onToggle={() => toggle("conversationAlerts")}
            />
            <SettingsRow
              icon={assets.settings.volume}
              title="Typing sound"
              description="Play a sound when a customer is typing."
              enabled={values.typingSound}
              onToggle={() => toggle("typingSound")}
            />
            <SettingsRow
              icon={assets.settings.layers}
              title="Auto-assign new chats"
              description="Automatically route incoming conversations to available agents."
              enabled={values.autoAssign}
              onToggle={() => toggle("autoAssign")}
              last
            />
          </div>

          <div className="settings-card ai-settings-card">
            <div className="settings-card-heading">
              <h3>AI assistant</h3>
              <p>Use AI to help draft replies, summarize conversations, and suggest next actions.</p>
            </div>
            <SettingsRow
              icon={assets.settings.sparkles}
              title="AI reply suggestions"
              description="Enable AI to suggest quick replies and follow-up messages."
              enabled={values.aiReplies}
              onToggle={() => toggle("aiReplies")}
            />
            <SettingsRow
              icon={assets.settings.message}
              title="AI summary notes"
              description="Generate a quick summary after each customer conversation."
              enabled={values.aiSummaries}
              onToggle={() => toggle("aiSummaries")}
            />
            <SettingsRow
              icon={assets.settings.archive}
              title="AI training data"
              description="Review and approve AI training examples from your team."
              chevron={assets.settings.chevron}
              onOpen={() => notify("AI training data opened")}
            />
            <SettingsRow
              icon={assets.settings.send}
              title="Auto-response settings"
              description="Edit away messages and first-response templates."
              chevron={assets.settings.chevronAlt}
              onOpen={() => notify("Auto-response settings opened")}
              last
            />
          </div>

          <div className="settings-card">
            <SettingsRow
              icon={assets.settings.userX}
              title="Blocked customers"
              description="Manage customers who cannot start new chats."
              chevron={assets.settings.chevronAlt}
              onOpen={() => notify("Blocked customers opened")}
            />
            <SettingsRow
              icon={assets.settings.minus}
              title="Spam & abuse controls"
              description="Review flagged messages and blocked keywords."
              chevron={assets.settings.chevronAlt}
              onOpen={() => notify("Spam and abuse controls opened")}
              last
            />
          </div>
        </div>
      </section>
    </div>
  );
}
