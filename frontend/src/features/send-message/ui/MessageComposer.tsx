import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { useConversationMessages, useMessageStore } from "@/entities/message";
import { API_URL } from "@/shared/config";
import { assets } from "@/shared/config";
import { AssetIcon, notify } from "@/shared/ui";
import {
  ACCEPTED_FILES,
  MAX_CHOSEN_FILES,
  chooseFiles,
  extensionOf,
  formatFileSize,
  removeChosenFile,
  sendChosenFiles,
  useChosenFiles,
  useUploadStore,
  type ChosenFile,
} from "../model/files";
import { sendMessage, updateDraft, useComposerStore, useDraft } from "../model/store";
import { canRecordVoice, MAX_RECORDING_MS, startVoiceRecording, stopVoiceRecording } from "../model/voice";

/** 75000 → "1:15". */
const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** The live "Recording 0:07" bar of a voice message, with cancel. */
function RecordingBar({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="recording-bar" role="status" aria-live="off">
      <span className="recording-dot" aria-hidden="true" />
      <span className="recording-time">{clock(now - since)}</span>
      <span className="recording-hint">Recording… press the microphone to send (up to {clock(MAX_RECORDING_MS)})</span>
      <button type="button" onClick={() => stopVoiceRecording(false)} aria-label="Cancel recording">
        ×
      </button>
    </div>
  );
}

const KIND_LABEL: Record<ChosenFile["kind"], string> = {
  image: "Image",
  pdf: "PDF",
  word: "Word",
  sheet: "Spreadsheet",
  text: "Text",
  audio: "Audio",
  video: "Video",
};

/** One chosen file: a thumbnail for images, a colored type badge otherwise, with name, size and a remove button. */
function AttachmentCard({ chosen, onRemove }: { chosen: ChosenFile; onRemove: () => void }) {
  const { file, kind, previewUrl } = chosen;
  return (
    <li className="attachment-card" title={file.name}>
      {previewUrl ? (
        <img className="attachment-thumb" src={previewUrl} alt="" />
      ) : (
        <span className={`attachment-badge kind-${kind}`} aria-hidden="true">
          {extensionOf(file.name).slice(0, 4).toUpperCase()}
        </span>
      )}
      <span className="attachment-info">
        <span className="attachment-name">{file.name}</span>
        <span className="attachment-meta">
          {KIND_LABEL[kind]} · {formatFileSize(file.size)}
        </span>
      </span>
      <button type="button" className="attachment-remove" onClick={onRemove} aria-label={`Remove ${file.name}`}>
        ×
      </button>
    </li>
  );
}

export default function MessageComposer({
  conversationId,
  extraControls,
}: {
  conversationId: string;
  /** Extra buttons next to the attach button, supplied by the widget (for example the saved replies picker). */
  extraControls?: ReactNode;
}) {
  const draft = useDraft(conversationId);
  const files = useChosenFiles(conversationId);
  const recording = useComposerStore((state) => state.recording);
  const toggleRecording = useComposerStore((state) => state.toggleRecording);
  const recordingSince = useComposerStore((state) => state.recordingSince);
  // Select the stable object; a selector returning a fresh array loops forever in Zustand 5.
  const progress = useUploadStore((state) => state.progress);
  const uploading = Object.values(progress);
  const uploadPercent = uploading.length
    ? Math.round((uploading.reduce((sum, value) => sum + value, 0) / uploading.length) * 100)
    : 0;
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyTargetId = useMessageStore((state) => state.replyTarget[conversationId]);
  const replyTarget = useConversationMessages(conversationId).find((message) => message.id === replyTargetId);
  const realVoice = !!API_URL && canRecordVoice();

  const addFiles = (list: FileList | readonly File[] | null | undefined) => {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    const problems = chooseFiles(conversationId, picked);
    problems.forEach((problem) => notify(problem));
    const added = picked.length - problems.length;
    if (added > 0 && problems.length === 0) notify(added === 1 ? "File attached" : `${added} files attached`);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Chosen files go first, each as its own message; the draft becomes the caption of the first one.
    const sent = sendChosenFiles(conversationId);
    if (sent > 0) return notify(sent === 1 ? "Sending file…" : `Sending ${sent} files…`);
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

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const onDragOver = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!dragging) setDragging(true);
  };
  const onDragLeave = (event: DragEvent<HTMLFormElement>) => {
    // Leaving for a child element is not leaving the composer.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData?.files ?? []);
    if (pasted.length === 0) return; // plain text pastes as usual
    event.preventDefault();
    addFiles(pasted);
  };

  return (
    <form
      className={`prompt-input${dragging ? " is-dragging" : ""}${files.length ? " has-files" : ""}`}
      onSubmit={submit}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <AssetIcon src={assets.icons.paperclip} size={18} />
          Drop files to attach
        </div>
      )}
      {files.length > 0 && (
        <ul className="attachment-tray" aria-label="Files to send">
          {files.map((chosen) => (
            <AttachmentCard
              key={chosen.id}
              chosen={chosen}
              onRemove={() => removeChosenFile(conversationId, chosen.id)}
            />
          ))}
        </ul>
      )}
      <textarea
        value={draft}
        onChange={(event) => updateDraft(conversationId, event.target.value)}
        onPaste={onPaste}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
        }}
        placeholder={files.length ? "Add a caption (optional)" : "Type a message"}
        aria-label={files.length ? "Caption for the files" : "Type a message"}
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
      {uploading.length > 0 && (
        <div className="upload-status" role="status">
          <span>
            {uploading.length === 1 ? "Uploading" : `Uploading ${uploading.length} files`} {uploadPercent}%
          </span>
          <span className="upload-bar">
            <span style={{ width: `${uploadPercent}%` }} />
          </span>
        </div>
      )}
      {recording && realVoice && recordingSince !== null && <RecordingBar since={recordingSince} />}
      <div className="prompt-controls">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach files"
          title={`Attach files: images (up to 10 MB), PDF, Word, Excel, text, audio or video (up to 25 MB), ${MAX_CHOSEN_FILES} at a time. You can also drop or paste them.`}
        >
          <AssetIcon src={assets.icons.plus} />
        </button>
        {extraControls}
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            event.target.value = "";
            addFiles(picked);
          }}
        />
        <div>
          <button
            className={recording ? "recording" : ""}
            type="button"
            onClick={toggleVoice}
            aria-label={recording ? "Stop and send voice message" : "Record voice message"}
            aria-pressed={recording}
            title={recording ? "Stop and send" : "Record a voice message"}
          >
            <AssetIcon src={assets.icons.mic} size={18} />
          </button>
          <button
            className={`submit-message${draft.trim() || files.length ? " ready" : ""}`}
            type="submit"
            aria-label={files.length ? `Send ${files.length === 1 ? "file" : `${files.length} files`}` : "Send message"}
            disabled={!draft.trim() && files.length === 0}
          >
            <span />
          </button>
        </div>
      </div>
    </form>
  );
}
