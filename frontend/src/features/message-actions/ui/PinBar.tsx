import { useEffect, useState } from "react";
import { API_URL } from "@/shared/config";
import { loadPins, useConversationPins, type PinnedMessage } from "../model/pins";

/**
 * The pinned messages of a conversation, one at a time, like the pin bar in WhatsApp or Telegram: clicking jumps to the
 * pinned message and moves on to the next pin. Hidden when nothing is pinned (and with the mock server).
 */
export default function PinBar({
  conversationId,
  onOpen,
}: {
  conversationId: string;
  onOpen: (pin: PinnedMessage) => void;
}) {
  const pins = useConversationPins(conversationId);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (API_URL) void loadPins(conversationId);
  }, [conversationId]);

  if (pins.length === 0) return null;
  const current = pins[index % pins.length] as PinnedMessage;

  return (
    <button
      type="button"
      className="pin-bar"
      onClick={() => {
        onOpen(current);
        setIndex((index + 1) % pins.length);
      }}
      title="Go to the pinned message"
    >
      <span aria-hidden="true">📌</span>
      <span className="pin-bar-text">
        <strong>Pinned message{pins.length > 1 ? ` ${(index % pins.length) + 1} of ${pins.length}` : ""}</strong>
        <span>{current.text || "File"}</span>
      </span>
    </button>
  );
}
