import { useMemo, useRef } from "react";
import { notify } from "@/shared/ui";
import { useSharedFilesStore, type MediaFilter, type SharedFile } from "../model/store";

const FILTERS: MediaFilter[] = ["All", "Documents", "Images"];

function downloadFile(file: SharedFile, customer: string, appId: string) {
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
  onBack,
}: {
  customer: string;
  appId: string;
  onBack: () => void;
}) {
  const { files, filter, setFilter, add } = useSharedFilesStore();
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
        <button type="button" onClick={onBack} aria-label="Back to customer details">
          ←
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
      <button type="button" className="upload-file" onClick={() => inputRef.current?.click()}>
        <span>＋</span>
        <div>
          <strong>Upload a file</strong>
          <small>PDF, JPG, PNG up to 10 MB</small>
        </div>
      </button>
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
        {visible.length === 0 && <p className="empty-files">No files in this category.</p>}
      </div>
    </section>
  );
}
