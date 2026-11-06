import { useState } from "react";
import type { ChatMessage } from "@/entities/message";
import { saveEdit, useEditingStore } from "../model/actions";

/** Replaces a message's text while it is being edited. Enter saves, Escape cancels. */
export default function MessageEditor({ message }: { message: ChatMessage }) {
  const [text, setText] = useState(message.text);
  return (
    <div className="message-editor">
      <textarea
        autoFocus
        value={text}
        aria-label="Edit message"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") useEditingStore.getState().set(null);
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void saveEdit(message, text);
          }
        }}
      />
      <div>
        <button type="button" onClick={() => void saveEdit(message, text)}>
          Save
        </button>
        <button type="button" onClick={() => useEditingStore.getState().set(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
