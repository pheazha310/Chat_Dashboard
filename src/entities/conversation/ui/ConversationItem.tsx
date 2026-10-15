import { formatListTime } from "@/shared/lib/format-time";
import type { Conversation } from "../model/store";

export default function ConversationItem({
  conversation,
  selected,
  onSelect,
}: {
  conversation: Conversation;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`conversation-item ${selected ? "selected" : ""}`} onClick={onSelect}>
      <img className="conversation-avatar" src={conversation.avatar} alt="" />
      <span className="conversation-content">
        <span className="conversation-line">
          <strong>{conversation.name}</strong>
          <time>{formatListTime(conversation.lastMessageAt)}</time>
        </span>
        <span className="conversation-line">
          <span className={conversation.urgent ? "urgent-copy" : "preview-copy"}>{conversation.preview}</span>
          {conversation.unread > 0 && (
            <b className={conversation.urgent ? "unread urgent" : "unread"}>{conversation.unread}</b>
          )}
        </span>
      </span>
    </button>
  );
}
