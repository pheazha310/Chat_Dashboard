import { useMemo } from "react";
import { ConversationItem, useConversationStore } from "@/entities/conversation";
import { selectConversation } from "@/features/select-conversation";
import { useMessageSettingsStore } from "@/features/message-settings";
import { assets } from "@/shared/config";
import { AssetIcon, Icon, IconPill } from "@/shared/ui";

type Props = { open: boolean; onClose: () => void; onExpand: () => void };

export default function ConversationSidebar({ open, onClose, onExpand }: Props) {
  const byId = useConversationStore((state) => state.byId);
  const order = useConversationStore((state) => state.order);
  const selectedId = useConversationStore((state) => state.selectedId);
  const query = useConversationStore((state) => state.query);
  const setQuery = useConversationStore((state) => state.setQuery);
  const openSettings = useMessageSettingsStore((state) => state.setOpen);
  const visible = useMemo(
    () =>
      order
        .map((id) => byId[id])
        .filter((conversation) => conversation && conversation.name.toLowerCase().includes(query.toLowerCase())),
    [byId, order, query],
  );

  return (
    <aside className={`message-sidebar ${open ? "panel-open" : ""}`}>
      <div className="sidebar-title">
        <h1>Message</h1>
        <div className="sidebar-actions">
          <IconPill left="moreVert" right="collapse" />
          <button className="settings-hit" onClick={() => openSettings(true)} aria-label="Open message settings" />
          <button className="zoom-hit" onClick={onExpand} aria-label="Open expanded applications workspace" />
        </div>
        <button className="close-mobile" onClick={onClose} aria-label="Close messages">
          ×
        </button>
      </div>
      <label className="sidebar-search">
        <AssetIcon src={assets.icons.search} size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Quick Search"
          aria-label="Search messages"
        />
      </label>
      <div className="conversation-list">
        {visible.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            conversation={conversation}
            selected={conversation.id === selectedId}
            onSelect={() => {
              selectConversation(conversation.id);
              onClose();
            }}
          />
        ))}
      </div>
    </aside>
  );
}
