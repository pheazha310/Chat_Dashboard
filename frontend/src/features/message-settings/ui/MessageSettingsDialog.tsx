import { useEffect, useState } from "react";
import { assets } from "@/shared/config";
import { cn } from "@/shared/lib/utils";
import { Button, Dialog, DialogClose, DialogContent, DialogTitle } from "@/shared/ui";
import SettingsDetail, { pageTitles, type SettingsPage } from "./SettingsDetail";
import { useMessageSettingsStore } from "../model/store";
import SettingsRow from "./SettingsRow";

export default function MessageSettingsDialog() {
  const { open, values, setOpen, toggle } = useMessageSettingsStore();
  const [page, setPage] = useState<SettingsPage | null>(null);

  useEffect(() => {
    if (open) setPage(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          // Figma sizing and look stay in index.css; these only undo the shadcn defaults that clash with it.
          "message-settings max-w-[calc(100%-3rem)] gap-0 text-base/normal sm:max-w-[calc(100%-3rem)]",
          page && "message-settings-detail",
        )}
      >
        <header>
          <DialogTitle>{page ? pageTitles[page] : "Message setting"}</DialogTitle>
          <DialogClose render={<Button variant="ghost" size="icon-sm" />} aria-label="Close message settings">
            ×
          </DialogClose>
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
      </DialogContent>
    </Dialog>
  );
}
