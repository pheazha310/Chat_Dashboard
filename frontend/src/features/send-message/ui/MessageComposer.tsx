import { useRef, type FormEvent, type ReactNode } from "react";
import { useConversationMessages, useMessageStore } from "@/entities/message";
import { API_URL } from "@/shared/config";
import { assets } from "@/shared/config";
import { AssetIcon, notify } from "@/shared/ui";
import {
  ACCEPTED_FILES,
  chooseFile,
  clearChosenFile,
  hasChosenFile,
  sendChosenFile,
  useUploadStore,
} from "../model/files";
import { sendMessage, updateDraft, useAttachment, useComposerStore, useDraft } from "../model/store";
import { canRecordVoice, startVoiceRecording, stopVoiceRecording } from "../model/voice";

export default function MessageComposer({
  conversationId,
  extraControls,
}: {
  conversationId: string;
  /** Extra buttons next to the attach button, supplied by the widget (for example the saved replies picker). */
  extraControls?: ReactNode;
}) {
  const draft = useDraft(conversationId);
  const attachment = useAttachment(conversationId);
  const { recording, setAttachment, toggleRecording } = useComposerStore();
  // Select the stable object; a selector returning a fresh array loops forever in Zustand 5.
  const progress = useUploadStore((state) => state.progress);
  const uploading = Object.values(progress);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyTargetId = useMessageStore((state) => state.replyTarget[conversationId]);
  const replyTarget = useConversationMessages(conversationId).find((message) => message.id === replyTargetId);
  const realVoice = !!API_URL && canRecordVoice();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // With the real backend a chosen file is uploaded; the draft becomes its caption.
    if (hasChosenFile(conversationId) && sendChosenFile(conversationId)) return notify("Sending file…");
    if (sendMessage(conversationId, draft)) notify("Message sent");
  };

  const toggleVoice = () => {
    if (!realVoice) {
      toggleRecording();
      return notify(recording ? "Voice recording stopped" : "Voice recording started");
    }
    if (recording) stopVoiceRecording(true);
    else void startVoiceRecording(conversationId);
  };

  return (
    <form className="prompt-input" onSubmit={submit}>
      <textarea
        value={draft}
        onChange={(event) => updateDraft(conversationId, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
        }}
        placeholder="Type a message"
        aria-label="Type a message"
      />
      {replyTarget && (
        <div className="attachment-chip reply-chip">
          Replying to: {replyTarget.text.slice(0, 80)}
          <button
            type="button"
            onClick={() => useMessageStore.getState().setReplyTarget(conversationId, undefined)}
            aria-label="Cancel reply"
          >
            ×
          </button>
        </div>
      )}
      {attachment && (
        <div className="attachment-chip">
          <AssetIcon src={assets.icons.paperclip} size={14} />
          {attachment}
          <button
            type="button"
            onClick={() => (API_URL ? clearChosenFile(conversationId) : setAttachment(conversationId, ""))}
            aria-label="Remove attachment"
          >
            ×
          </button>
        </div>
      )}
      {uploading.length > 0 && (
        <div className="attachment-chip" role="status">
          Uploading {Math.round(Math.max(...uploading) * 100)}%
        </div>
      )}
      {recording && realVoice && (
        <div className="attachment-chip recording-chip" role="status">
          Recording… press the microphone to send
          <button type="button" onClick={() => stopVoiceRecording(false)} aria-label="Cancel recording">
            ×
          </button>
        </div>
      )}
      <div className="prompt-controls">
        <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Add attachment">
          <AssetIcon src={assets.icons.plus} />
        </button>
        {extraControls}
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept={API_URL ? ACCEPTED_FILES : ".pdf,.jpg,.jpeg,.png"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (!API_URL) {
              setAttachment(conversationId, file.name);
              return notify("File attached");
            }
            const problem = chooseFile(conversationId, file);
            notify(problem ?? "File attached");
          }}
        />
        <div>
          <button
            className={recording ? "recording" : ""}
            type="button"
            onClick={toggleVoice}
            aria-label="Record voice message"
          >
            <AssetIcon src={assets.icons.mic} size={18} />
          </button>
          <button
            className="submit-message"
            type="submit"
            aria-label="Send message"
            disabled={!draft.trim() && !(API_URL && attachment)}
          >
            <span />
          </button>
        </div>
      </div>
    </form>
  );
}
