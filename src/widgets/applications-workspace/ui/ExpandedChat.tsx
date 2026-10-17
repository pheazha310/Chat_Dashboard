import { useRef, useState, type PointerEvent } from "react";
import { useSelectedConversation } from "@/entities/conversation";
import { useConversationMessages } from "@/entities/message";
import { sendMessage, useComposerStore, useDraft } from "@/features/send-message";
import { TakeOverButton } from "@/features/take-over-conversation";
import { assets } from "@/shared/config";
import { formatClock } from "@/shared/lib/format-time";
import { AssetIcon, IconButton, notify } from "@/shared/ui";

export default function ExpandedChat({ onBack }: { onBack: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const chatDraft = useDraft(conversationId);
  const attachment = useComposerStore((state) => state.attachments[conversationId] ?? "");
  const recording = useComposerStore((state) => state.recording);
  const setChatDraft = (text: string) => useComposerStore.getState().setDraft(conversationId, text);

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
        <IconButton
          className="expanded-back"
          icon={assets.zoom.back}
          size={16}
          label="Back to messages"
          onClick={onBack}
        />
        <img className="expanded-avatar" src={conversation?.avatar ?? assets.zoom.customer} alt="" />
        <div>
          <strong>{conversation?.name ?? "LAY Vila"}</strong>
          <span>
            <img src={assets.zoom.online} alt="" />
            Active
          </span>
        </div>
        <img className="expanded-chat-actions" src={assets.zoom.chatActions} alt="" />
      </header>
      <div className="expanded-chat-stream">
        <span className="expanded-today">Today</span>
        {messages.map((message) => (
          <div className={`expanded-message ${message.side === "customer" ? "customer" : "ai"}`} key={message.id}>
            {message.side === "customer" ? (
              <p>{message.text}</p>
            ) : (
              <div>
                <strong>{message.side === "assistant" ? "AI ASSISTANT" : "SUPPORT AGENT"}</strong>
                <p>{message.text}</p>
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
              <button
                onClick={() =>
                  setChatDraft(
                    `Hi ${conversation?.name.split(" ")[0]}, I’m reviewing your repayment date request and will confirm the updated schedule shortly.`,
                  )
                }
              >
                Regenerate Draft
              </button>
            </section>
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (sendMessage(conversationId, chatDraft)) notify("Message sent");
          }}
        >
          <textarea
            value={chatDraft}
            onChange={(event) => setChatDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (sendMessage(conversationId, chatDraft)) notify("Message sent");
              }
            }}
            placeholder="Type a message"
            aria-label="Type a message"
          />
          {attachment && (
            <div className="attachment-chip">
              {attachment}
              <button
                type="button"
                onClick={() => useComposerStore.getState().setAttachment(conversationId, "")}
                aria-label="Remove attachment"
              >
                ×
              </button>
            </div>
          )}
          <div>
            <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Add attachment">
              <img src={assets.icons.plus} alt="" />
            </button>
            <input
              ref={fileInputRef}
              className="file-input"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  useComposerStore.getState().setAttachment(conversationId, file.name);
                  notify("File attached");
                }
              }}
            />
            <span>
              <IconButton
                className={recording ? "recording" : ""}
                icon={assets.icons.mic}
                size={18}
                label="Record voice message"
                onClick={() => {
                  useComposerStore.getState().toggleRecording();
                  notify(recording ? "Voice recording stopped" : "Voice recording started");
                }}
              />
              <button className="expanded-send" type="submit" aria-label="Send message" disabled={!chatDraft.trim()}>
                <AssetIcon src={assets.settings.send} size={14} />
              </button>
            </span>
          </div>
        </form>
      </div>
    </aside>
  );
}
