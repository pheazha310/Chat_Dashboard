import "./message-actions.css";
import { useState } from "react";
import { useConversationStore } from "@/entities/conversation";
import type { ChatMessage } from "@/entities/message";
import { API_URL } from "@/shared/config";
import { confirmAction } from "@/shared/ui";
import {
  availableActions,
  copyMessage,
  deleteMessage,
  forwardMessage,
  replyTo,
  toggleReaction,
  useEditingStore,
} from "../model/actions";
import { togglePin, useConversationPins } from "../model/pins";

const EMOJI = ["👍", "❤️", "😂", "🙏", "✅"];

/** The "more" menu of one message. Hidden against the mock server, which has no message actions. */
export default function MessageActions({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const conversations = useConversationStore((state) => state.byId);
  const pinned = useConversationPins(message.conversationId).some((pin) => pin.messageId === message.id);
  if (!API_URL) return null;

  const can = availableActions(message);
  const customerId = conversations[message.conversationId]?.customerId;
  // The server only allows the same customer's other conversations that the agent owns; the list is a convenience.
  const targets = Object.values(conversations).filter(
    (c) => c.id !== message.conversationId && customerId !== undefined && c.customerId === customerId,
  );
  const close = () => {
    setOpen(false);
    setForwarding(false);
  };

  return (
    <div className="message-actions">
      <button
        type="button"
        aria-label="Message actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <div className="message-actions-menu" role="menu">
          {can.react && (
            <div className="message-actions-emoji">
              {EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`React ${emoji}`}
                  onClick={() => {
                    void toggleReaction(message, emoji);
                    close();
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          {can.reply && (
            <button type="button" role="menuitem" onClick={() => (replyTo(message), close())}>
              Reply
            </button>
          )}
          {can.react && (
            <button type="button" role="menuitem" onClick={() => (void togglePin(message), close())}>
              {pinned ? "Unpin" : "Pin for everyone"}
            </button>
          )}
          {can.copy && (
            <button type="button" role="menuitem" onClick={() => (void copyMessage(message), close())}>
              Copy
            </button>
          )}
          {can.edit && (
            <button type="button" role="menuitem" onClick={() => (useEditingStore.getState().set(message.id), close())}>
              Edit
            </button>
          )}
          {can.forward && !forwarding && (
            <button type="button" role="menuitem" disabled={targets.length === 0} onClick={() => setForwarding(true)}>
              Forward{targets.length === 0 ? " (no other chat)" : "…"}
            </button>
          )}
          {forwarding && (
            <div className="message-actions-forward">
              {targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => {
                    void forwardMessage(message, target.id);
                    close();
                  }}
                >
                  {target.name} · {target.application.reference}
                </button>
              ))}
            </div>
          )}
          {can.remove && (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                close();
                void confirmAction({
                  title: "Delete this message?",
                  description: "The message will be removed from the conversation for everyone.",
                  confirmLabel: "Delete",
                }).then((ok) => {
                  if (ok) void deleteMessage(message);
                });
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
