import { useMemo } from "react";
import {
  ConversationItem,
  FILTERS,
  filterConversations,
  loadArchived,
  useConversationStore,
} from "@/entities/conversation";
import { selectConversation } from "@/features/select-conversation";
import { useMessageSettingsStore } from "@/features/message-settings";
import { useSessionStore } from "@/shared/api/session";
import { assets } from "@/shared/config";
import { AssetIcon, IconPill } from "@/shared/ui";

type Props = { open: boolean; onClose: () => void; onExpand: () => void };

export default function ConversationSidebar({ open, onClose, onExpand }: Props) {
  const byId = useConversationStore((state) => state.byId);
  const order = useConversationStore((state) => state.order);
  const selectedId = useConversationStore((state) => state.selectedId);
  const query = useConversationStore((state) => state.query);
  const setQuery = useConversationStore((state) => state.setQuery);
  const filter = useConversationStore((state) => state.filter);
  const setFilter = useConversationStore((state) => state.setFilter);
  const me = useSessionStore((state) => state.userId);
  const openSettings = useMessageSettingsStore((state) => state.setOpen);
  const visible = useMemo(
    () =>
      filterConversations(
        order.map((id) => byId[id]),
        { filter, query, me },
      ),
    [byId, order, filter, query, me],
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
          placeholder="Search name or message"
          aria-label="Search messages"
        />
      </label>
      <div className="sidebar-filters" role="tablist" aria-label="Filter conversations">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={filter === id ? "active" : ""}
            onClick={() => {
              setFilter(id);
              if (id === "archived") void loadArchived();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="conversation-list">
        {visible.length === 0 && <div className="empty-search">No conversations found</div>}
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
