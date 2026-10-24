import { useRef, type FormEvent } from "react";
import { assets } from "@/shared/config";
import { AssetIcon, notify } from "@/shared/ui";
import { sendMessage, useAttachment, useComposerStore, useDraft } from "../model/store";

export default function MessageComposer({ conversationId }: { conversationId: string }) {
  const draft = useDraft(conversationId);
  const attachment = useAttachment(conversationId);
  const { recording, setDraft, setAttachment, toggleRecording } = useComposerStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sendMessage(conversationId, draft)) notify("Message sent");
  };

  return (
    <form className="prompt-input" onSubmit={submit}>
      <textarea
        value={draft}
        onChange={(event) => setDraft(conversationId, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
        }}
        placeholder="Type a message"
        aria-label="Type a message"
      />
      {attachment && (
        <div className="attachment-chip">
          <AssetIcon src={assets.icons.paperclip} size={14} />
          {attachment}
          <button type="button" onClick={() => setAttachment(conversationId, "")} aria-label="Remove attachment">
            ×
          </button>
        </div>
      )}
      <div className="prompt-controls">
        <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Add attachment">
          <AssetIcon src={assets.icons.plus} />
        </button>
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              setAttachment(conversationId, file.name);
              notify("File attached");
            }
          }}
        />
        <div>
          <button
            className={recording ? "recording" : ""}
            type="button"
            onClick={() => {
              toggleRecording();
              notify(recording ? "Voice recording stopped" : "Voice recording started");
            }}
            aria-label="Record voice message"
          >
            <AssetIcon src={assets.icons.mic} size={18} />
          </button>
          <button className="submit-message" type="submit" aria-label="Send message" disabled={!draft.trim()}>
            <span />
          </button>
        </div>
      </div>
    </form>
  );
}
