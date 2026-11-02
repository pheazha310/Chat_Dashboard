import { useEffect, useRef, useState } from "react";
import { assets } from "@/shared/config";
import SettingsDetail, { pageTitles, type SettingsPage } from "./SettingsDetail";
import { useMessageSettingsStore } from "../model/store";
import SettingsRow from "./SettingsRow";

export default function MessageSettingsDialog() {
  const { open, values, setOpen, toggle } = useMessageSettingsStore();
  const [page, setPage] = useState<SettingsPage | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setPage(null);
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="settings-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
    >
      <section
        className={`message-settings ${page ? "message-settings-detail" : ""}`}
        role="dialog"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input, textarea"),
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        aria-modal="true"
        aria-labelledby="message-settings-title"
      >
        <header>
          <h2 id="message-settings-title">{page ? pageTitles[page] : "Message setting"}</h2>
          <button ref={closeRef} onClick={() => setOpen(false)} aria-label="Close message settings">
            ×
          </button>
        </header>
        <div className="settings-content">
          {page ? (
            <SettingsDetail key={page} page={page} onBack={() => setPage(null)} />
          ) : (
            <>
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
                  onOpen={() => setPage("training")}
                />
                <SettingsRow
                  icon={assets.settings.send}
                  title="Auto-response settings"
                  description="Edit away messages and first-response templates."
                  chevron={assets.settings.chevronAlt}
                  onOpen={() => setPage("responses")}
                  last
                />
              </div>

              <div className="settings-card">
                <SettingsRow
                  icon={assets.settings.userX}
                  title="Blocked customers"
                  description="Manage customers who cannot start new chats."
                  chevron={assets.settings.chevronAlt}
                  onOpen={() => setPage("blocked")}
                />
                <SettingsRow
                  icon={assets.settings.minus}
                  title="Spam & abuse controls"
                  description="Review flagged messages and blocked keywords."
                  chevron={assets.settings.chevronAlt}
                  onOpen={() => setPage("spam")}
                  last
                />
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
