import { useEffect, useMemo, useState } from "react";
import {
  ConversationItem,
  ensureConversation,
  FILTERS,
  filterConversations,
  loadArchived,
  loadMoreConversations,
  paginate,
  useConversationStore,
  type ConversationSort,
  type PriorityFilter,
} from "@/entities/conversation";
import { selectConversation } from "@/features/select-conversation";
import { InboxMessageResults, showMessage } from "@/features/search-in-chat";
import { useMessageSettingsStore } from "@/features/message-settings";
import { useSessionStore } from "@/shared/api/session";
import { API_URL, assets } from "@/shared/config";
import { AssetIcon, IconPill } from "@/shared/ui";

const PAGE_SIZE = 10;

type Props = { open: boolean; onClose: () => void; onExpand: () => void };

export default function ConversationSidebar({ open, onClose, onExpand }: Props) {
  const byId = useConversationStore((state) => state.byId);
  const order = useConversationStore((state) => state.order);
  const selectedId = useConversationStore((state) => state.selectedId);
  const query = useConversationStore((state) => state.query);
  const setQuery = useConversationStore((state) => state.setQuery);
  const filter = useConversationStore((state) => state.filter);
  const setFilter = useConversationStore((state) => state.setFilter);
  const priorityFilter = useConversationStore((state) => state.priorityFilter);
  const setPriorityFilter = useConversationStore((state) => state.setPriorityFilter);
  const tagFilter = useConversationStore((state) => state.tagFilter);
  const setTagFilter = useConversationStore((state) => state.setTagFilter);
  const sort = useConversationStore((state) => state.sort);
  const setSort = useConversationStore((state) => state.setSort);
  const hasMore = useConversationStore((state) => state.inboxHasMore);
  const loadingMore = useConversationStore((state) => state.inboxLoading);
  const me = useSessionStore((state) => state.userId);
  const openSettings = useMessageSettingsStore((state) => state.setOpen);
  const visible = useMemo(
    () =>
      filterConversations(
        order.map((id) => byId[id]),
        { filter, query, me, priority: priorityFilter, tag: tagFilter, sort },
      ),
    [byId, order, filter, query, me, priorityFilter, tagFilter, sort],
  );
  const [requestedPage, setPage] = useState(1);
  useEffect(() => setPage(1), [filter, query, priorityFilter, tagFilter, sort]);
  const { items: pageItems, page, totalPages } = paginate(visible, requestedPage, PAGE_SIZE);
  const canGoNext = page < totalPages || (hasMore && filter !== "archived");
  const goNext = async () => {
    if (page < totalPages) return setPage(page + 1);
    const before = useConversationStore.getState().order.length;
    await loadMoreConversations();
    if (useConversationStore.getState().order.length > before) setPage(page + 1);
  };
  // Only tags that some loaded conversation carries can narrow the list.
  const tagOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const conversation of Object.values(byId)) {
      for (const tag of conversation.tags ?? []) seen.set(tag.id, tag.name);
    }
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [byId]);

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
      {API_URL && (
        <div className="sidebar-refine">
          <select
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
            aria-label="Filter by priority"
          >
            <option value="all">Any priority</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select
            value={tagFilter ?? ""}
            onChange={(event) => setTagFilter(event.target.value || null)}
            aria-label="Filter by tag"
            disabled={tagOptions.length === 0 && tagFilter === null}
          >
            <option value="">Any tag</option>
            {tagOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as ConversationSort)}
            aria-label="Sort conversations"
          >
            <option value="recent">Latest first</option>
            <option value="priority">By priority</option>
          </select>
        </div>
      )}
      <div className="conversation-list">
        {query.trim() && <h2 className="inbox-results-heading">Customers</h2>}
        {visible.length === 0 && <div className="empty-search">No conversations found</div>}
        {pageItems.map((conversation) => (
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
        <InboxMessageResults
          query={query}
          onOpen={async (hit) => {
            // Open the chat (fetching it if the inbox has not loaded it), then load back to the message and scroll there.
            if (!(await ensureConversation(hit.conversationId))) return;
            selectConversation(hit.conversationId);
            onClose();
            await showMessage(hit.conversationId, {
              id: hit.messageId,
              ...(hit.sequence === undefined ? {} : { sequence: hit.sequence }),
            });
          }}
        />
      </div>
      {(totalPages > 1 || canGoNext) && (
        <nav className="conversation-pager" aria-label="Conversation pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
            ‹ Prev
          </button>
          <span>
            Page {page} of {totalPages}
            {hasMore && filter !== "archived" ? "+" : ""}
          </span>
          <button
            type="button"
            disabled={!canGoNext || loadingMore}
            onClick={() => void goNext()}
            aria-label="Next page"
          >
            {loadingMore ? "Loading…" : "Next ›"}
          </button>
        </nav>
      )}
    </aside>
  );
}
