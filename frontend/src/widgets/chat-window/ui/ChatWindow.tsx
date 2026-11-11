import { Fragment, useEffect, useRef, useState } from "react";
import { canReply, useSelectedConversation } from "@/entities/conversation";
import {
  dayKey,
  dayLabel,
  MessageBubble,
  TypingBubble,
  loadOlderMessages,
  useConversationMessages,
  useHistory,
  useMessageStore,
} from "@/entities/message";
import { escalateConversation } from "@/features/escalate-conversation";
import { ChatTabs } from "@/features/chat-tabs";
import {
  MessageActions,
  MessageEditor,
  PinBar,
  useConversationPins,
  useEditingStore,
} from "@/features/message-actions";
import { selectConversation } from "@/features/select-conversation";
import { archiveConversation, restoreConversation } from "@/features/archive-conversation";
import { markConversationUnread } from "@/features/mark-unread";
import { takeOverConversation, TakeOverButton } from "@/features/take-over-conversation";
import { useSessionStore } from "@/shared/api/session";
import { ChatSearchBar, JumpToDateButton, showMessage, useChatSearchStore } from "@/features/search-in-chat";
import { blockConversationCustomerAction, reportSpamAction } from "@/features/moderate-conversation";
import { TemplatePicker } from "@/features/canned-responses";
import { insertIntoDraft, MessageComposer, retryMessage, useComposerStore } from "@/features/send-message";
import { API_URL, assets } from "@/shared/config";
import { AssetIcon, IconButton, notify, Icon, promptAction } from "@/shared/ui";
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
  onOpenNotes,
  onOpenOrganize,
  onOpenCallbacks,
}: {
  onOpenContext: () => void;
  onOpenMedia: () => void;
  onOpenNotes: () => void;
  onOpenOrganize: () => void;
  onOpenCallbacks: () => void;
}) {
  const conversation = useSelectedConversation();
  const messages = useConversationMessages(conversation?.id ?? null);
  const typing = useMessageStore((state) => (conversation ? state.typing[conversation.id] : undefined));
  const history = useHistory(conversation?.id ?? null);
  const me = useSessionStore((state) => state.userId);
  const searchOpen = useChatSearchStore((state) => state.open);
  const searchQuery = useChatSearchStore((state) => state.query);
  const searchFocus = useChatSearchStore((state) => state.focus);
  const pins = useConversationPins(conversation?.id ?? "");
  const toggleSearch = useChatSearchStore((state) => state.toggle);
  const editingId = useEditingStore((state) => state.editingId);
  const setDraft = useComposerStore((state) => state.setDraft);
  const [showMore, setShowMore] = useState(false);
  const [flashId, setFlashId] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Follow the newest message, but not while the agent is searching back in time, and not when older pages load.
  const newestId = messages.at(-1)?.id;
  useEffect(() => {
    if (!searchOpen) endRef.current?.scrollIntoView({ block: "end" });
  }, [newestId, typing, conversation?.id, searchOpen]);

  // Search belongs to one conversation: switching customers closes it.
  useEffect(() => {
    useChatSearchStore.getState().close();
  }, [conversation?.id]);

  const jumpTo = (messageId: string) => {
    const element = streamRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashId(messageId);
  };

  useEffect(() => {
    if (searchFocus && searchFocus.conversationId === conversation?.id) jumpTo(searchFocus.id);
  }, [searchFocus]);

  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(undefined), 1600);
    return () => clearTimeout(timer);
  }, [flashId]);

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
      <ChatTabs onSelect={selectConversation} />
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
          <IconButton
            icon={assets.icons.chatSearch}
            size={24}
            label="Search conversation (Ctrl+F)"
            onClick={toggleSearch}
          />
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
              {API_URL && (
                <>
                  <button
                    onClick={() => {
                      onOpenNotes();
                      setShowMore(false);
                    }}
                  >
                    Internal notes
                  </button>
                  <button
                    onClick={() => {
                      onOpenOrganize();
                      setShowMore(false);
                    }}
                  >
                    Priority & tags
                  </button>
                  <button
                    onClick={() => {
                      onOpenCallbacks();
                      setShowMore(false);
                    }}
                  >
                    Callbacks
                  </button>
                  <button
                    onClick={() => {
                      setShowMore(false);
                      void promptAction({
                        title: "Report spam or abuse",
                        description: "Supervisors will review this report.",
                        inputLabel: "What happened?",
                        placeholder: "e.g. Repeated threatening messages",
                        required: true,
                        maxLength: 2000,
                        confirmLabel: "Report",
                        destructive: true,
                      }).then((reason) => {
                        if (reason) void reportSpamAction(conversation.id, reason);
                      });
                    }}
                  >
                    Report spam or abuse
                  </button>
                  {conversation.handoff === "assigned" && !handledByOther && (
                    <button
                      onClick={() => {
                        setShowMore(false);
                        void promptAction({
                          title: "Block this customer?",
                          description: "They will no longer be able to send messages.",
                          inputLabel: "Reason",
                          confirmLabel: "Block customer",
                          destructive: true,
                        }).then((reason) => {
                          if (reason !== null) void blockConversationCustomerAction(conversation.id, reason);
                        });
                      }}
                    >
                      Block customer
                    </button>
                  )}
                  {conversation.handoff === "assigned" && !handledByOther && (
                    <button
                      onClick={() => {
                        setShowMore(false);
                        void promptAction({
                          title: "Escalate to supervisor",
                          inputLabel: "Why are you escalating?",
                          placeholder: "e.g. Customer is asking for a fee waiver",
                          confirmLabel: "Escalate",
                        }).then((reason) => {
                          if (reason !== null) void escalateConversation(conversation.id, reason);
                        });
                      }}
                    >
                      Escalate to supervisor
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <ChatSearchBar conversationId={conversation.id} />
      <PinBar
        conversationId={conversation.id}
        onOpen={(pin) => void showMessage(conversation.id, { id: pin.messageId, sequence: pin.sequence })}
      />
      <div className="chat-stream" aria-live="polite" ref={streamRef}>
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
        {messages.map((message, index) => (
          <Fragment key={message.id}>
            {dayKey(message.createdAt) !== dayKey(messages[index - 1]?.createdAt ?? "") && (
              <JumpToDateButton
                conversationId={conversation.id}
                className="today-pill"
                label={`${dayLabel(message.createdAt)}: jump to another date`}
              >
                {dayLabel(message.createdAt)}
              </JumpToDateButton>
            )}
            <MessageBubble
              message={message}
              showReadReceipts
              onRetry={(failed) => retryMessage(failed.conversationId, failed.id)}
              {...(message.replyToId ? { replyTo: messages.find((m) => m.id === message.replyToId) } : {})}
              {...(searchOpen && searchQuery.trim() ? { highlight: searchQuery } : {})}
              focused={flashId === message.id}
              pinned={pins.some((pin) => pin.messageId === message.id)}
              onQuoteClick={(original) => jumpTo(original.id)}
              actions={<MessageActions message={message} />}
              {...(editingId === message.id ? { body: <MessageEditor message={message} /> } : {})}
            />
          </Fragment>
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
        {/* With the backend only the agent who handles the conversation may write (text, files or voice); the mock
            server lets anyone. Others see why, and can take it over, instead of failing after typing or recording. */}
        {!API_URL || canReply(conversation, me) ? (
          <MessageComposer
            conversationId={conversation.id}
            extraControls={
              API_URL ? <TemplatePicker onInsert={(text) => insertIntoDraft(conversation.id, text)} /> : undefined
            }
          />
        ) : (
          <div className="reply-lock" role="status">
            <span>
              {handledByOther && conversation.assignedAgent
                ? `${conversation.assignedAgent.name} is handling this conversation. Take it over to reply.`
                : "Take over this conversation to reply with a message, a file or a voice message."}
            </span>
            {conversation.handoff !== "needs-human" && <TakeOverButton conversationId={conversation.id} />}
          </div>
        )}
      </div>
    </section>
  );
}
