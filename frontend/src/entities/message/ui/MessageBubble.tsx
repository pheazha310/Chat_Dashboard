import { assets } from "@/shared/config";
import { formatClock } from "@/shared/lib/format-time";
import type { ChatMessage } from "../model/store";

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
}: {
  message: ChatMessage;
  showReadReceipts?: boolean;
  onRetry?: (message: ChatMessage) => void;
}) {
  const { side } = message;
  const status = message.status === "read" && !showReadReceipts ? "delivered" : message.status;
  const caption = [formatClock(message.createdAt), status && side !== "assistant" ? STATUS_LABEL[status] : null]
    .filter(Boolean)
    .join(" • ");

  return (
    <div className={`message-block ${side} ${status === "failed" ? "failed" : ""}`}>
      <div className="message-line">
        <div className="message-bubble">
          {side !== "customer" && <strong>{side === "assistant" ? "AI ASSISTANT" : "SUPPORT AGENT"}</strong>}
          <p>{message.text}</p>
        </div>
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
