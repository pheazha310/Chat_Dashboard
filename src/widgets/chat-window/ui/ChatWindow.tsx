import { useEffect, useMemo, useRef, useState } from "react";
import { useSelectedConversation } from "@/entities/conversation";
import { MessageBubble, TypingBubble, useConversationMessages, useMessageStore } from "@/entities/message";
import { usePrivacyStore } from "@/features/privacy-controls";
import { ChatSearchBar, filterByQuery, useChatSearchStore } from "@/features/search-in-chat";
import { MessageComposer, useComposerStore } from "@/features/send-message";
import { assets } from "@/shared/config";
import { AssetIcon, IconButton, notify } from "@/shared/ui";
import HandoffCard from "./HandoffCard";

const PRESENCE = {
  "needs-human": "active • awaiting human response",
  ai: "active • handled by AI assistant",
  assigned: "active • handled by you",
} as const;

export default function ChatWindow({ onOpenContext }: { onOpenContext: () => void }) {
  const conversation = useSelectedConversation();
  const messages = useConversationMessages(conversation?.id ?? null);
  const typing = useMessageStore((state) => (conversation ? state.typing[conversation.id] : undefined));
  const readReceipts = usePrivacyStore((state) => state.readReceipts);
  const { query, toggle } = useChatSearchStore();
  const setDraft = useComposerStore((state) => state.setDraft);
  const [showMore, setShowMore] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const visible = useMemo(() => filterByQuery(messages, query, (message) => message.text), [messages, query]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [visible.length, typing, conversation?.id]);

  if (!conversation) return <section className="active-chat" />;

  const firstName = conversation.name.split(" ")[0];
  const menuAction = (text: string) => () => {
    notify(text);
    setShowMore(false);
  };

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
              <img src={assets.icons.online} alt="" /> {PRESENCE[conversation.handoff]}
            </p>
          </div>
        </div>
        <div className="chat-actions">
          <IconButton icon={assets.icons.chatSearch} size={24} label="Search conversation" onClick={toggle} />
          <button onClick={() => notify(`Calling ${conversation.name}...`)} aria-label={`Call ${conversation.name}`}>
            <AssetIcon src={assets.icons.phone} />
          </button>
          <button onClick={() => setShowMore((current) => !current)} aria-label="More options">
            <AssetIcon src={assets.icons.more} size={16} />
          </button>
          <button className="context-trigger" onClick={onOpenContext} aria-label="Open customer details">
            i
          </button>
          {showMore && (
            <div className="more-menu">
              <button onClick={menuAction("Conversation marked unread")}>Mark as unread</button>
              <button onClick={menuAction("Conversation assigned to you")}>Assign to me</button>
              <button onClick={menuAction("Conversation archived")}>Archive conversation</button>
            </div>
          )}
        </div>
      </header>

      <ChatSearchBar />
      <div className="chat-stream" aria-live="polite">
        <div className="today-pill">Today</div>
        {hasQuery && visible.length === 0 && <div className="empty-search">No messages match “{trimmedQuery}”</div>}
        {visible.map((message) => (
          <MessageBubble key={message.id} message={message} showReadReceipts={readReceipts} />
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
        {conversation.handoff === "assigned" && (
          <div className="takeover-confirmation">You’re now handling this conversation.</div>
        )}
        <MessageComposer conversationId={conversation.id} />
      </div>
    </section>
  );
}
