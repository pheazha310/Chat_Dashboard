import "./chat-tabs.css";
import { useEffect } from "react";
import { useConversationStore } from "@/entities/conversation";
import { closeTab, openTab, useChatTabsStore } from "../model/store";

/** One tab per open conversation. The conversation being viewed always has a tab. */
export default function ChatTabs({ onSelect }: { onSelect: (id: string) => void }) {
  const openIds = useChatTabsStore((state) => state.openIds);
  const selectedId = useConversationStore((state) => state.selectedId);
  const byId = useConversationStore((state) => state.byId);

  useEffect(() => {
    if (selectedId && byId[selectedId]) openTab(selectedId);
  }, [selectedId, byId]);

  const tabs = openIds.filter((id) => byId[id]);
  if (tabs.length < 2) return null;

  return (
    <div className="chat-tabs" role="tablist" aria-label="Open conversations">
      {tabs.map((id) => {
        const conversation = byId[id];
        if (!conversation) return null;
        return (
          <div key={id} className={`chat-tab${id === selectedId ? " active" : ""}`}>
            <button role="tab" aria-selected={id === selectedId} onClick={() => onSelect(id)}>
              {conversation.name}
              {conversation.unread > 0 && <span className="chat-tab-unread">{conversation.unread}</span>}
            </button>
            <button
              className="chat-tab-close"
              aria-label={`Close tab ${conversation.name}`}
              onClick={() => {
                const next = closeTab(id);
                if (id === selectedId && next) onSelect(next);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
