import { useState } from "react";
import { ChatWindow } from "@/widgets/chat-window";
import { ConversationSidebar } from "@/widgets/conversation-sidebar";
import { CustomerContext } from "@/widgets/customer-context";
import { TopNavbar } from "@/widgets/top-navbar";
import { MessageSettingsDialog } from "@/features/message-settings";

export default function ChatPage({ onExpand }: { onExpand: () => void }) {
  const [showInbox, setShowInbox] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [contextView, setContextView] = useState<"media" | null>(null);

  return (
    <main className="lending-crm">
      <TopNavbar onOpenInbox={() => setShowInbox(true)} />
      <div className="workspace">
        <ConversationSidebar open={showInbox} onClose={() => setShowInbox(false)} onExpand={onExpand} />
        <ChatWindow
          onOpenContext={() => setShowContext(true)}
          onOpenMedia={() => {
            setContextView("media");
            setShowContext(true);
          }}
        />
        <CustomerContext
          open={showContext}
          view={contextView}
          onViewChange={setContextView}
          onClose={() => setShowContext(false)}
        />
      </div>
      {(showInbox || showContext) && (
        <button
          className="mobile-overlay"
          onClick={() => {
            setShowInbox(false);
            setShowContext(false);
          }}
          aria-label="Close panel"
        />
      )}
      <MessageSettingsDialog />
    </main>
  );
}
