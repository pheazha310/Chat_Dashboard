import { useEffect, useRef, useState } from "react";
import { DownloadIcon, FileTextIcon } from "lucide-react";
import { parseCsv } from "@/shared/lib/csv";
import { fileExtension } from "@/shared/lib/file-name";
import { formatBytes } from "@/shared/lib/format-size";
import { saveAttachment, useAttachmentUrl } from "@/shared/lib/use-attachment-url";
import { Button, Dialog, DialogContent, DialogTitle, DialogTrigger, notify } from "@/shared/ui";
import type { AttachmentDto } from "@/shared/api/ws";

type Preview = "pdf" | "text" | "csv" | "docx" | "xlsx" | "none";
type Sheet = { name: string; rows: string[][] };

const PREVIEWS: Record<string, Preview> = {
  PDF: "pdf",
  TXT: "text",
  CSV: "csv",
  DOCX: "docx",
  XLSX: "xlsx",
};
const previewFor = (extension: string): Preview => PREVIEWS[extension] ?? "none";
const MAX_ROWS = 1000;

/** Reads a blob URL with `read`; null while loading, `undefined` when it fails. */
function useBlobResult<T>(url: string | null, read: (blob: Blob) => Promise<T>): T | null | undefined {
  const [result, setResult] = useState<T | null | undefined>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setResult(null);
    fetch(url)
      .then((response) => response.blob())
      .then(read)
      .then((value) => !cancelled && setResult(value))
      .catch(() => !cancelled && setResult(undefined));
    return () => {
      cancelled = true;
    };
    // `read` is a module-level function per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return result;
}

const readText = (blob: Blob) => blob.text();
const readCsv = async (blob: Blob): Promise<Sheet[]> => [{ name: "", rows: parseCsv(await blob.text()) }];
const readXlsx = async (blob: Blob): Promise<Sheet[]> => {
  const { default: readExcelFile } = await import("read-excel-file/browser");
  const sheets = await readExcelFile(blob);
  return sheets.map(({ sheet, data }) => ({
    name: sheet,
    rows: data.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))),
  }));
};

function SheetTable({ sheets }: { sheets: Sheet[] }) {
  const [active, setActive] = useState(0);
  const sheet = sheets[active] ?? sheets[0];
  if (!sheet) return <p className="attachment-doc-empty">This file is empty.</p>;
  const shown = sheet.rows.slice(0, MAX_ROWS);
  return (
    <div className="attachment-doc-sheet">
      {sheets.length > 1 && (
        <div className="attachment-doc-tabs" role="tablist">
          {sheets.map((item, index) => (
            <button
              key={item.name}
              type="button"
              role="tab"
              aria-selected={index === active}
              onClick={() => setActive(index)}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      <div className="attachment-doc-scroll">
        <table>
          <tbody>
            {shown.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.rows.length > MAX_ROWS && (
        <small className="attachment-doc-note">
          Showing the first {MAX_ROWS} of {sheet.rows.length} rows. Download the file to see all of it.
        </small>
      )}
    </div>
  );
}

function DocxView({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const target = container.current;
    if (!target) return;
    let cancelled = false;
    setFailed(false);
    Promise.all([import("docx-preview"), fetch(url).then((response) => response.blob())])
      .then(([{ renderAsync }, blob]) =>
        cancelled ? undefined : renderAsync(blob, target, undefined, { inWrapper: true }),
      )
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      target.replaceChildren();
    };
  }, [url]);
  if (failed) return <p className="attachment-doc-empty">Could not display this document. Download it to open it.</p>;
  return <div ref={container} className="attachment-doc-docx" />;
}

function Loading({ loading }: { loading: boolean }) {
  return <p className="attachment-doc-empty">{loading ? "Loading…" : ""}</p>;
}

function Unavailable({ attachment }: { attachment: AttachmentDto }) {
  return (
    <div className="attachment-doc-empty">
      <FileTextIcon aria-hidden />
      <p>Preview is not available for {fileExtension(attachment.fileName)} files. Download it to open it.</p>
    </div>
  );
}

function TextView({ url }: { url: string }) {
  const text = useBlobResult(url, readText);
  if (text === undefined) return <p className="attachment-doc-empty">Could not read this file.</p>;
  if (text === null) return <Loading loading />;
  return <pre className="attachment-doc-text">{text}</pre>;
}

function SheetView({ url, read }: { url: string; read: (blob: Blob) => Promise<Sheet[]> }) {
  const sheets = useBlobResult(url, read);
  if (sheets === undefined) return <p className="attachment-doc-empty">Could not read this file.</p>;
  if (sheets === null) return <Loading loading />;
  return <SheetTable sheets={sheets} />;
}

function DocumentBody({ attachment, preview, open }: { attachment: AttachmentDto; preview: Preview; open: boolean }) {
  const { url, error, loading } = useAttachmentUrl(
    attachment.downloadPath,
    open && preview !== "none",
    preview === "pdf" ? "application/pdf" : undefined,
  );

  if (preview === "none") return <Unavailable attachment={attachment} />;
  if (error) return <p className="attachment-doc-empty">Could not load {attachment.fileName}</p>;
  if (!url) return <Loading loading={loading} />;
  switch (preview) {
    case "pdf":
      return <iframe className="attachment-doc-frame" src={url} title={attachment.fileName} />;
    case "text":
      return <TextView url={url} />;
    case "csv":
      return <SheetView url={url} read={readCsv} />;
    case "xlsx":
      return <SheetView url={url} read={readXlsx} />;
    case "docx":
      return <DocxView url={url} />;
  }
}

/** A file card that opens an in-app viewer on click: PDF, Word (.docx), Excel (.xlsx), CSV and TXT are shown, other types offer the download. */
export default function DocumentAttachment({ attachment }: { attachment: AttachmentDto }) {
  const [open, setOpen] = useState(false);
  const preview = previewFor(fileExtension(attachment.fileName));
  const download = () =>
    void saveAttachment(attachment.downloadPath, attachment.fileName).catch(() =>
      notify(`Could not download ${attachment.fileName}`),
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="attachment-file" title={`View ${attachment.fileName}`}>
        <span className="attachment-file-icon" aria-hidden>
          <FileTextIcon />
        </span>
        <span className="attachment-file-info">
          <strong>{attachment.fileName}</strong>
          <small>
            {fileExtension(attachment.fileName)} · {formatBytes(attachment.size)}
          </small>
        </span>
      </DialogTrigger>
      <DialogContent className="attachment-doc-viewer sm:max-w-[min(1100px,calc(100vw-2rem))]">
        <div className="attachment-doc-header">
          <DialogTitle className="attachment-doc-title">{attachment.fileName}</DialogTitle>
          <Button variant="secondary" size="sm" onClick={download}>
            <DownloadIcon />
            Download
          </Button>
        </div>
        <DocumentBody attachment={attachment} preview={preview} open={open} />
      </DialogContent>
    </Dialog>
  );
}
