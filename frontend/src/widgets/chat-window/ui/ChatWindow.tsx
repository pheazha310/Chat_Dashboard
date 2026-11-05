import { useEffect, useMemo, useRef, useState } from "react";
import { useSelectedConversation } from "@/entities/conversation";
import {
  MessageBubble,
  TypingBubble,
  loadOlderMessages,
  useConversationMessages,
  useHistory,
  useMessageStore,
} from "@/entities/message";
import { archiveConversation, restoreConversation } from "@/features/archive-conversation";
import { markConversationUnread } from "@/features/mark-unread";
import { takeOverConversation } from "@/features/take-over-conversation";
import { useSessionStore } from "@/shared/api/session";
import { ChatSearchBar, filterByQuery, useChatSearchStore } from "@/features/search-in-chat";
import { MessageComposer, retryMessage, useComposerStore } from "@/features/send-message";
import { assets } from "@/shared/config";
import { AssetIcon, IconButton, notify, Icon } from "@/shared/ui";
import { useCustomerCallStore } from "@/features/customer-call";
import HandoffCard from "./HandoffCard";

const PRESENCE = {
  "needs-human": "active • awaiting human response",
  ai: "active • handled by AI assistant",
  assigned: "active • handled by you",
} as const;

export default function ChatWindow({
  onOpenContext,
  onOpenMedia,
}: {
  onOpenContext: () => void;
  onOpenMedia: () => void;
}) {
  const conversation = useSelectedConversation();
  const messages = useConversationMessages(conversation?.id ?? null);
  const typing = useMessageStore((state) => (conversation ? state.typing[conversation.id] : undefined));
  const history = useHistory(conversation?.id ?? null);
  const me = useSessionStore((state) => state.userId);
  const { query, toggle } = useChatSearchStore();
  const setDraft = useComposerStore((state) => state.setDraft);
  const [showMore, setShowMore] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const visible = useMemo(() => filterByQuery(messages, query, (message) => message.text), [messages, query]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [visible.length, typing, conversation?.id]);

  useEffect(() => {
    if (!showMore) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !actionsRef.current?.contains(event.target as Node))
        setShowMore(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [showMore]);

  if (!conversation)
    return (
      <section className="active-chat">
        <div className="empty-search">Select a conversation to start chatting</div>
      </section>
    );

  const firstName = conversation.name.split(" ")[0];
  const handledByOther = conversation.assignedAgent !== undefined && conversation.assignedAgent.id !== me;
  const presence =
    conversation.handoff === "assigned" && handledByOther
      ? `active • handled by ${conversation.assignedAgent?.name}`
      : PRESENCE[conversation.handoff];
  const closeMenu = () => setShowMore(false);

  return (
    <section className="active-chat">
      <header className="chat-header">
        <div className="chat-identity">
          <img src={conversation.avatar} alt="" />
          <div>
            <div className="identity-line">
              <h2>{conversation.name}</h2>
              {conversation.urgent && <span className="priority-pill">Priority</span>}
              {conversation.unread > 0 && <span className="message-pill">{conversation.unread} messages</span>}
            </div>
            <p>
              <Icon src={assets.icons.online} alt="" /> {presence}
            </p>
          </div>
        </div>
        <div className="chat-actions" ref={actionsRef}>
          <IconButton icon={assets.icons.chatSearch} size={24} label="Search conversation" onClick={toggle} />
          <button
            onClick={() => useCustomerCallStore.getState().start(conversation)}
            aria-label={`Call ${conversation.name}`}
          >
            <AssetIcon src={assets.icons.phone} />
          </button>
          <button
            onClick={() => setShowMore((current) => !current)}
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={showMore}
          >
            <AssetIcon src={assets.icons.more} size={16} />
          </button>
          <button className="context-trigger" onClick={onOpenContext} aria-label="Open customer details">
            i
          </button>
          {showMore && (
            <div className="more-menu" role="menu">
              <button
                onClick={() => {
                  markConversationUnread(conversation.id);
                  notify("Conversation marked unread");
                  closeMenu();
                }}
              >
                Mark as unread
              </button>
              {(conversation.handoff !== "assigned" || handledByOther) && (
                <button
                  onClick={() => {
                    // The server decides; the list updates from its answer, or a notice explains the refusal.
                    takeOverConversation(conversation.id);
                    closeMenu();
                  }}
                >
                  Assign to me
                </button>
              )}
              {conversation.archived ? (
                <button
                  onClick={() => {
                    void restoreConversation(conversation.id).then((ok) => ok && notify("Conversation restored"));
                    closeMenu();
                  }}
                >
                  Restore conversation
                </button>
              ) : (
                <button
                  onClick={() => {
                    void archiveConversation(conversation.id).then((ok) => ok && notify("Conversation archived"));
                    closeMenu();
                  }}
                >
                  Archive conversation
                </button>
              )}
              <button
                onClick={() => {
                  onOpenMedia();
                  setShowMore(false);
                }}
              >
                Media & files
              </button>
            </div>
          )}
        </div>
      </header>

      <ChatSearchBar />
      <div className="chat-stream" aria-live="polite">
        {history?.hasMore && (
          <button
            type="button"
            className="load-earlier"
            disabled={history.loading}
            onClick={() => void loadOlderMessages(conversation.id)}
          >
            {history.loading ? "Loading…" : "Load earlier messages"}
          </button>
        )}
        <div className="today-pill">Today</div>
        {hasQuery && visible.length === 0 && <div className="empty-search">No messages match “{trimmedQuery}”</div>}
        {visible.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            showReadReceipts
            onRetry={(failed) => retryMessage(failed.conversationId, failed.id)}
          />
        ))}
        {typing === "customer" && <TypingBubble />}
        <div ref={endRef} />
      </div>

      <div className="chat-input-area">
        {conversation.handoff === "needs-human" && (
          <HandoffCard
            conversationId={conversation.id}
            onRegenerateDraft={() =>
              setDraft(
                conversation.id,
                `Hi ${firstName}, I’m reviewing your request and will confirm the updated schedule shortly.`,
              )
            }
          />
        )}
        {conversation.handoff === "assigned" && !handledByOther && (
          <div className="takeover-confirmation">You’re now handling this conversation.</div>
        )}
        <MessageComposer conversationId={conversation.id} />
      </div>
    </section>
  );
}
