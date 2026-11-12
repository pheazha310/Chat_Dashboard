import { useEffect, useRef, useState, type PointerEvent } from "react";
import { canReply, useSelectedConversation } from "@/entities/conversation";
import { AttachmentView, useConversationMessages } from "@/entities/message";
import { MessageComposer, updateDraft } from "@/features/send-message";
import { useMessageSettingsStore } from "@/features/message-settings";
import { MediaFilesPanel } from "@/features/share-files";
import { archiveConversation, restoreConversation } from "@/features/archive-conversation";
import { markConversationUnread } from "@/features/mark-unread";
import { TakeOverButton, takeOverConversation } from "@/features/take-over-conversation";
import { useSessionStore } from "@/shared/api/session";
import { API_URL, assets } from "@/shared/config";
import { formatClock } from "@/shared/lib/format-time";
import { confirmAction, notify, IconPill } from "@/shared/ui";

export default function ExpandedChat({ onBack }: { onBack: () => void }) {
  const aiReplies = useMessageSettingsStore((state) => state.values.aiReplies);
  const [showMedia, setShowMedia] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const me = useSessionStore((state) => state.userId);
  const actionsRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!showActions) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          setShowActions(false);
          moreRef.current?.focus();
        }
      } else if (!actionsRef.current?.contains(event.target as Node)) setShowActions(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [showActions]);
  const closeActions = () => {
    setShowActions(false);
    moreRef.current?.focus();
  };
  const chatRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const resize = useRef<{
    pointerId: number;
    edge: string;
    startX: number;
    startY: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const resizeFrame = useRef<number | null>(null);
  const pendingSize = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const conversation = useSelectedConversation();
  const conversationId = conversation?.id ?? "";
  const messages = useConversationMessages(conversation?.id ?? null);

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, textarea")) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPosition({ left: bounds.left, top: bounds.top });
  };

  const moveWindow = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const windowElement = event.currentTarget.parentElement;
    if (!windowElement) return;
    const bounds = windowElement.getBoundingClientRect();
    const left = Math.max(0, Math.min(window.innerWidth - bounds.width, event.clientX - drag.current.offsetX));
    const top = Math.max(0, Math.min(window.innerHeight - bounds.height, event.clientY - drag.current.offsetY));
    setPosition({ left, top });
  };

  const stopDrag = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const startResize = (event: PointerEvent<HTMLSpanElement>) => {
    const bounds = chatRef.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    resize.current = {
      pointerId: event.pointerId,
      edge: event.currentTarget.dataset.edge ?? "se",
      startX: event.clientX,
      startY: event.clientY,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event: PointerEvent<HTMLSpanElement>) => {
    const start = resize.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const minWidth = Math.min(320, window.innerWidth - 20);
    const minHeight = Math.min(300, window.innerHeight - 20);
    let { left, top, width, height } = start;
    const dx = event.clientX - start.startX;
    const dy = event.clientY - start.startY;
    if (start.edge.includes("e")) width = Math.max(minWidth, Math.min(window.innerWidth - left, start.width + dx));
    if (start.edge.includes("s")) height = Math.max(minHeight, Math.min(window.innerHeight - top, start.height + dy));
    if (start.edge.includes("w")) {
      width = Math.max(minWidth, Math.min(start.width + dx, start.left + start.width));
      left = start.left + start.width - width;
    }
    if (start.edge.includes("n")) {
      height = Math.max(minHeight, Math.min(start.height + dy, start.top + start.height));
      top = start.top + start.height - height;
    }
    pendingSize.current = { left, top, width, height };
    if (resizeFrame.current === null) {
      resizeFrame.current = requestAnimationFrame(() => {
        const next = pendingSize.current;
        pendingSize.current = null;
        if (next) {
          setPosition({ left: next.left, top: next.top });
          setSize({ width: next.width, height: next.height });
        }
        resizeFrame.current = null;
      });
    }
  };

  const stopResize = (event: PointerEvent<HTMLSpanElement>) => {
    if (resize.current?.pointerId !== event.pointerId) return;
    resize.current = null;
    if (resizeFrame.current !== null) {
      cancelAnimationFrame(resizeFrame.current);
      resizeFrame.current = null;
    }
    const next = pendingSize.current;
    if (next) {
      setPosition({ left: next.left, top: next.top });
      setSize({ width: next.width, height: next.height });
      pendingSize.current = null;
    }
  };

  return (
    <aside
      ref={chatRef}
      className="expanded-chat"
      style={{
        ...(size ? { width: size.width, height: size.height } : {}),
        ...(position ? { left: position.left, top: position.top, right: "auto", bottom: "auto" } : {}),
      }}
    >
      <header onPointerDown={startDrag} onPointerMove={moveWindow} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
        <button type="button" className="expanded-back" aria-label="Back to messages" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m14 5-7 7 7 7"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <img className="expanded-avatar" src={conversation?.avatar ?? assets.zoom.customer} alt="" />
        <div className="expanded-chat-identity">
          <strong>{conversation?.name ?? "LAY Vila"}</strong>
          <span>
            <i className="expanded-presence-dot" aria-hidden="true" />
            Active
          </span>
        </div>
        <div className="expanded-chat-actions" ref={actionsRef}>
          <IconPill left="call" right="moreVert" />
          <button
            className="expanded-call-trigger"
            aria-label={`Call ${conversation?.name ?? "customer"}`}
            disabled={!conversation}
            onClick={() =>
              void confirmAction({
                title: "Coming soon",
                description: "Calling is not available yet.",
                confirmLabel: "OK",
                cancelLabel: "Close",
                destructive: false,
              })
            }
          />
          <button
            ref={moreRef}
            className="expanded-more-trigger"
            aria-label="More conversation options"
            aria-haspopup="menu"
            aria-expanded={showActions}
            onClick={() => setShowActions(!showActions)}
          />
          {showActions && (
            <div className="expanded-actions-menu" role="menu" aria-label="Conversation actions">
              <button
                role="menuitem"
                disabled={!conversation}
                onClick={() => {
                  markConversationUnread(conversationId);
                  closeActions();
                  notify("Conversation marked unread");
                }}
              >
                Mark as unread
              </button>
              {conversation && (conversation.handoff !== "assigned" || conversation.assignedAgent?.id !== me) && (
                <button
                  role="menuitem"
                  onClick={() => {
                    // The server decides; the list updates from its answer, or a notice explains the refusal.
                    takeOverConversation(conversationId);
                    closeActions();
                  }}
                >
                  Assign to me
                </button>
              )}
              <button
                role="menuitem"
                disabled={!conversation}
                onClick={() => {
                  const action = conversation?.archived ? restoreConversation : archiveConversation;
                  const done = conversation?.archived ? "Conversation restored" : "Conversation archived";
                  void action(conversationId).then((ok) => ok && notify(done));
                  closeActions();
                }}
              >
                {conversation?.archived ? "Restore conversation" : "Archive conversation"}
              </button>
              <button
                role="menuitem"
                disabled={!conversation}
                onClick={() => {
                  setShowActions(false);
                  setShowMedia(true);
                }}
              >
                Media &amp; files
              </button>
            </div>
          )}
        </div>
      </header>
      {showMedia && conversation ? (
        <div className="expanded-media-view">
          <MediaFilesPanel
            customer={conversation.name}
            appId={conversation.application.appId}
            conversationId={conversation.id}
            backLabel="Back to conversation"
            onBack={() => {
              setShowMedia(false);
              moreRef.current?.focus();
            }}
          />
        </div>
      ) : (
        <>
          <div className="expanded-chat-stream">
            <span className="expanded-today">Today</span>
            {messages.map((message) => (
              <div
                className={`expanded-message ${message.side === "customer" ? "customer" : message.side === "system" ? "system" : "ai"}`}
                key={message.id}
              >
                {message.side === "system" ? (
                  <p>{message.text}</p>
                ) : message.side === "customer" ? (
                  <>
                    {message.attachments?.map((attachment) => (
                      <AttachmentView key={attachment.id} attachment={attachment} />
                    ))}
                    {message.text && <p>{message.text}</p>}
                  </>
                ) : (
                  <div>
                    <strong>{message.side === "assistant" ? "AI ASSISTANT" : "SUPPORT AGENT"}</strong>
                    {message.attachments?.map((attachment) => (
                      <AttachmentView key={attachment.id} attachment={attachment} />
                    ))}
                    {message.text && <p>{message.text}</p>}
                  </div>
                )}
                <time>
                  {formatClock(message.createdAt)}
                  {message.status && message.side !== "assistant" ? ` • ${message.status}` : ""}
                </time>
              </div>
            ))}
          </div>
          {["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((edge) => (
            <span
              key={edge}
              className={`chat-resize-handle ${edge}`}
              data-edge={edge}
              aria-hidden="true"
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={stopResize}
              onPointerCancel={stopResize}
            />
          ))}
          <div className="expanded-composer">
            {conversation?.handoff === "needs-human" && (
              <div className="expanded-handoff">
                <div>
                  <span>Needs Human Review</span>
                  <time>Escalated 2 min ago</time>
                </div>
                <p>
                  Customer needs a repayment date change. Review, verify the customer, and confirm the updated schedule.
                </p>
                <section>
                  <TakeOverButton conversationId={conversationId} />
                  {aiReplies && (
                    <button
                      onClick={() =>
                        updateDraft(
                          conversationId,
                          `Hi ${conversation?.name.split(" ")[0]}, I’m reviewing your repayment date request and will confirm the updated schedule shortly.`,
                        )
                      }
                    >
                      Regenerate Draft
                    </button>
                  )}
                </section>
              </div>
            )}
            {!API_URL || !conversation || canReply(conversation, me) ? (
              <MessageComposer conversationId={conversationId} />
            ) : (
              <div className="reply-lock" role="status">
                <span>Take over this conversation to reply.</span>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
