import type { ReactNode } from "react";
import { assets } from "@/shared/config";
import { formatClock } from "@/shared/lib/format-time";
import type { ChatMessage } from "../model/store";
import AttachmentView from "./AttachmentView";

const STATUS_LABEL = {
  sending: "Sending…",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed to send",
} as const;

export default function MessageBubble({
  message,
  showReadReceipts = true,
  onRetry,
  replyTo,
  actions,
  body,
}: {
  message: ChatMessage;
  showReadReceipts?: boolean;
  onRetry?: (message: ChatMessage) => void;
  /** The message this one answers, if it is loaded (shown as a quote). */
  replyTo?: ChatMessage;
  /** Slot for the message action menu, supplied by the widget that composes features. */
  actions?: ReactNode;
  /** Replaces the text, e.g. with an inline editor. */
  body?: ReactNode;
}) {
  const { side } = message;
  const status = message.status === "read" && !showReadReceipts ? "delivered" : message.status;
  const caption = [
    formatClock(message.createdAt),
    message.edited ? "Edited" : null,
    status && side !== "assistant" ? STATUS_LABEL[status] : null,
  ]
    .filter(Boolean)
    .join(" • ");

  if (side === "system") {
    // Takeovers, transfers and status changes: a quiet note in the thread, not a chat bubble.
    return (
      <div className="message-block system">
        <p className="system-note">{message.text}</p>
        <time>{formatClock(message.createdAt)}</time>
      </div>
    );
  }

  if (message.deleted) {
    return (
      <div className={`message-block ${side}`}>
        <div className="message-line">
          <div className="message-bubble">
            <p className="message-deleted">This message was deleted</p>
          </div>
        </div>
        <time>{formatClock(message.createdAt)}</time>
      </div>
    );
  }

  return (
    <div className={`message-block ${side} ${status === "failed" ? "failed" : ""}`}>
      <div className="message-line">
        <div className="message-bubble">
          {side !== "customer" && <strong>{side === "assistant" ? "AI ASSISTANT" : "SUPPORT AGENT"}</strong>}
          {message.forwarded && <small className="message-forwarded">Forwarded</small>}
          {message.replyToId && (
            <blockquote className="message-quote">
              {replyTo?.deleted ? "Original message deleted" : replyTo ? replyTo.text : "Original message unavailable"}
            </blockquote>
          )}
          {message.attachments?.map((attachment) => (
            <AttachmentView key={attachment.id} attachment={attachment} />
          ))}
          {body ?? (message.text && !isFileLabel(message) && <p>{message.text}</p>)}
          {message.reactions && message.reactions.length > 0 && (
            <ul className="message-reactions" aria-label="Reactions">
              {groupReactions(message.reactions).map(({ emoji, count }) => (
                <li key={emoji}>
                  {emoji} {count > 1 && <span>{count}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {actions}
        {side === "assistant" && <img className="ai-avatar" src={assets.users.ai} alt="" />}
        {side === "agent" && <img className="agent-avatar" src={assets.users.agent} alt="" />}
      </div>
      <time>{caption}</time>
      {status === "failed" && onRetry && (
        <button type="button" className="retry-message" onClick={() => onRetry(message)}>
          Retry
        </button>
      )}
    </div>
  );
}

export function TypingBubble() {
  return (
    <div className="message-block customer" aria-label="Customer is typing">
      <div className="message-line">
        <div className="message-bubble typing">
          <p>•••</p>
        </div>
      </div>
    </div>
  );
}

function groupReactions(reactions: NonNullable<ChatMessage["reactions"]>) {
  const counts = new Map<string, number>();
  for (const { emoji } of reactions) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  return [...counts].map(([emoji, count]) => ({ emoji, count }));
}

/** A file message without a caption carries its file name as text (for the optimistic copy); the file itself is shown instead. */
const isFileLabel = (message: ChatMessage) =>
  (message.attachments?.length ?? 0) > 0 && message.attachments?.some((a) => a.fileName === message.text);
