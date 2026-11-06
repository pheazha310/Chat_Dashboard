import { useEffect, useState } from "react";
import { fetchAttachmentBlob } from "@/shared/api/rest";

type State = { url: string | null; error: boolean; loading: boolean };

/** Loads an attachment with the bearer token and returns a blob URL for `<img>`, `<audio>` or `<video>`. */
export function useAttachmentUrl(downloadPath: string | null, enabled = true): State {
  const [state, setState] = useState<State>({ url: null, error: false, loading: false });

  useEffect(() => {
    if (!downloadPath || !enabled) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState({ url: null, error: false, loading: true });
    fetchAttachmentBlob(downloadPath, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, error: false, loading: false });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ url: null, error: true, loading: false });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [downloadPath, enabled]);

  return state;
}

/** Saves an attachment through the browser's download, using the same authorised fetch. */
export async function saveAttachment(downloadPath: string, fileName: string) {
  const blob = await fetchAttachmentBlob(downloadPath);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
