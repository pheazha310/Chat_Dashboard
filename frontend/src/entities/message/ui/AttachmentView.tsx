import "./attachments.css";
import { DownloadIcon } from "lucide-react";
import { repairFileName } from "@/shared/lib/file-name";
import { formatDuration } from "@/shared/lib/format-size";
import { saveAttachment, useAttachmentUrl } from "@/shared/lib/use-attachment-url";
import { Button, Dialog, DialogContent, DialogTitle, DialogTrigger, notify } from "@/shared/ui";
import DocumentAttachment from "./DocumentAttachment";
import type { AttachmentDto } from "@/shared/api/ws";

const save = (file: AttachmentDto) =>
  saveAttachment(file.downloadPath, file.fileName).catch(() => notify(`Could not download ${file.fileName}`));

/** Image thumbnail that opens a full-screen viewer on click; the viewer offers the download. */
function ImageAttachment({ attachment, url }: { attachment: AttachmentDto; url: string | undefined }) {
  return (
    <Dialog>
      <DialogTrigger className="attachment-image" aria-label={`View ${attachment.fileName}`}>
        <img src={url} alt={attachment.fileName} />
      </DialogTrigger>
      <DialogContent className="attachment-viewer">
        <DialogTitle className="attachment-viewer-title">{attachment.fileName}</DialogTitle>
        <img src={url} alt={attachment.fileName} />
        <Button
          variant="secondary"
          size="sm"
          className="attachment-viewer-download"
          onClick={() => void save(attachment)}
        >
          <DownloadIcon />
          Download
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** One file in a message: images, audio and video are shown in place; everything else is a download button. */
export default function AttachmentView({ attachment: raw }: { attachment: AttachmentDto }) {
  const attachment = { ...raw, fileName: repairFileName(raw.fileName) };
  const inline = attachment.kind === "IMAGE" || attachment.kind === "AUDIO" || attachment.kind === "VIDEO";
  const { url, error, loading } = useAttachmentUrl(attachment.downloadPath, inline);

  if (inline && error) return <p className="attachment-error">Could not load {attachment.fileName}</p>;
  if (inline && !url) return <p className="attachment-loading">{loading ? "Loading…" : attachment.fileName}</p>;

  switch (attachment.kind) {
    case "IMAGE":
      return <ImageAttachment attachment={attachment} url={url ?? undefined} />;
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
      return <DocumentAttachment attachment={attachment} />;
  }
}
