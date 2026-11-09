import { useEffect, useMemo, useRef } from "react";
import { API_URL } from "@/shared/config";
import { saveAttachment } from "@/shared/lib/use-attachment-url";
import { notify } from "@/shared/ui";
import { useSharedFilesStore, type MediaFilter, type SharedFile } from "../model/store";

const FILTERS: MediaFilter[] = ["All", "Documents", "Images"];

function downloadFile(file: SharedFile, customer: string, appId: string) {
  if (file.downloadPath) {
    saveAttachment(file.downloadPath, file.name).catch(() => notify(`Could not download ${file.name}`));
    return;
  }
  const blob = new Blob([`Prototype file: ${file.name}\nCustomer: ${customer}\nApplication: ${appId}`], {
    type: "text/plain",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
  notify(`${file.name} downloaded`);
}

export default function MediaFilesPanel({
  customer,
  appId,
  conversationId,
  onBack,
  backLabel = "Back to customer details",
}: {
  customer: string;
  appId: string;
  /** With the real backend, the files of this conversation are loaded from the server. */
  conversationId?: string;
  onBack: () => void;
  backLabel?: string;
}) {
  const { files, filter, setFilter, add, load, loading, error } = useSharedFilesStore();
  const server = !!API_URL && conversationId !== undefined;
  useEffect(() => {
    if (server) void load(conversationId);
  }, [server, conversationId, load]);
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(
    () =>
      files.filter(
        (file) => filter === "All" || (filter === "Documents" ? file.kind === "Document" : file.kind === "Image"),
      ),
    [files, filter],
  );

  return (
    <section className="context-detail-panel">
      <header className="detail-panel-header">
        <button className="media-back-button" type="button" onClick={onBack} aria-label={backLabel} autoFocus>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m14 5-7 7 7 7"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div>
          <h3>Media & files</h3>
          <p>{files.length} shared items</p>
        </div>
      </header>
      <div className="media-filter">
        {FILTERS.map((item) => (
          <button
            type="button"
            className={filter === item ? "active" : ""}
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
            key={item}
          >
            {item}
          </button>
        ))}
      </div>
      {!server && (
        <button type="button" className="upload-file" onClick={() => inputRef.current?.click()}>
          <span>＋</span>
          <div>
            <strong>Upload a file</strong>
            <small>PDF, JPG, PNG up to 10 MB</small>
          </div>
        </button>
      )}
      <input
        ref={inputRef}
        className="file-input"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          add(file);
          notify("File uploaded securely");
          event.target.value = "";
        }}
      />
      <div className="file-list">
        {visible.map((file) => (
          <article className="shared-file" key={file.id}>
            <span className={`file-type ${file.kind.toLowerCase()}`}>{file.kind === "Document" ? "PDF" : "IMG"}</span>
            <div>
              <strong>{file.name}</strong>
              <small>
                {file.size} · {file.added}
              </small>
            </div>
            <button
              type="button"
              onClick={() => downloadFile(file, customer, appId)}
              aria-label={`Download ${file.name}`}
            >
              ↓
            </button>
          </article>
        ))}
        {loading && <p className="empty-files">Loading files…</p>}
        {error && <p className="empty-files">Could not load the files.</p>}
        {!loading && !error && visible.length === 0 && <p className="empty-files">No files in this category.</p>}
      </div>
    </section>
  );
}
