import "./attachments.css";
import { formatBytes, formatDuration } from "@/shared/lib/format-size";
import { saveAttachment, useAttachmentUrl } from "@/shared/lib/use-attachment-url";
import { notify } from "@/shared/ui";
import type { AttachmentDto } from "@/shared/api/ws";

const save = (file: AttachmentDto) =>
  saveAttachment(file.downloadPath, file.fileName).catch(() => notify(`Could not download ${file.fileName}`));

/** One file in a message: images, audio and video are shown in place; everything else is a download button. */
export default function AttachmentView({ attachment }: { attachment: AttachmentDto }) {
  const inline = attachment.kind === "IMAGE" || attachment.kind === "AUDIO" || attachment.kind === "VIDEO";
  const { url, error, loading } = useAttachmentUrl(attachment.downloadPath, inline);

  if (inline && error) return <p className="attachment-error">Could not load {attachment.fileName}</p>;
  if (inline && !url) return <p className="attachment-loading">{loading ? "Loading…" : attachment.fileName}</p>;

  switch (attachment.kind) {
    case "IMAGE":
      return (
        <button
          type="button"
          className="attachment-image"
          onClick={() => void save(attachment)}
          aria-label={`Download ${attachment.fileName}`}
        >
          <img src={url ?? undefined} alt={attachment.fileName} />
        </button>
      );
    case "AUDIO":
      return (
        <div className="attachment-audio">
          <audio controls preload="metadata" src={url ?? undefined} aria-label={attachment.fileName} />
          {attachment.durationMs !== undefined && <small>{formatDuration(attachment.durationMs)}</small>}
        </div>
      );
    case "VIDEO":
      return (
        <video
          className="attachment-video"
          controls
          preload="metadata"
          src={url ?? undefined}
          aria-label={attachment.fileName}
        />
      );
    default:
      return (
        <button type="button" className="attachment-file" onClick={() => void save(attachment)}>
          <span aria-hidden>📄</span>
          <span>
            <strong>{attachment.fileName}</strong>
            <small>{formatBytes(attachment.size)}</small>
          </span>
        </button>
      );
  }
}
