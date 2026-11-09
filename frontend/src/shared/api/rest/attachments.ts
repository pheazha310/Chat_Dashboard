import type { BackendAttachment, BackendMessage } from "@/shared/api/backend/types";
import { ensureFreshToken } from "@/shared/api/auth";
import { API_URL, getAuthToken } from "@/shared/config";
import { ApiError, apiRequest } from "./client";

export type UploadOptions = {
  clientId: string;
  /** 0 to 1, while the bytes are sent. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

/** A multipart POST with upload progress (fetch cannot report it). Resolves with the unwrapped `data`. */
async function upload<T>(
  path: string,
  form: FormData,
  { onProgress, signal }: Pick<UploadOptions, "onProgress" | "signal">,
) {
  await ensureFreshToken();
  return new Promise<T>((resolve, reject) => {
    if (!API_URL) return reject(new ApiError(0, "NOT_CONFIGURED", "The chat backend URL is not configured"));
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}${path}`);
    const token = getAuthToken();
    if (token) request.setRequestHeader("authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    request.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "Could not reach the chat backend"));
    request.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    request.onload = () => {
      let body: { status?: string; data?: T; error?: { code?: string; message?: string } } | undefined;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = undefined;
      }
      if (request.status >= 200 && request.status < 300 && body?.status === "success") return resolve(body.data as T);
      reject(
        new ApiError(
          request.status,
          body?.error?.code ?? "UNKNOWN_ERROR",
          body?.error?.message ?? `Upload failed (${request.status})`,
        ),
      );
    };
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(form);
  });
}

/** Sends a file as a message (docs/api-attachments.md). Safe to retry with the same `clientId`. */
export function uploadFileRequest(conversationId: string, file: File, options: UploadOptions & { text?: string }) {
  const form = new FormData();
  form.set("conversationId", conversationId);
  form.set("clientId", options.clientId);
  if (options.text) form.set("text", options.text);
  form.set("file", file, file.name);
  return upload<BackendMessage>("/attachments/upload", form, options);
}

export function uploadVoiceRequest(
  conversationId: string,
  file: File,
  options: UploadOptions & { durationMs?: number; waveform?: number[] },
) {
  const form = new FormData();
  form.set("clientId", options.clientId);
  if (options.durationMs !== undefined) form.set("durationMs", String(Math.max(1, Math.round(options.durationMs))));
  if (options.waveform?.length) form.set("waveform", JSON.stringify(options.waveform));
  form.set("file", file, file.name);
  return upload<BackendMessage>(`/conversations/${conversationId}/voice-messages`, form, options);
}

export type AttachmentKindFilter = "image" | "document" | "audio" | "video" | "voice";

export const listAttachments = async (conversationId: string, kind?: AttachmentKindFilter) =>
  (
    await apiRequest<BackendAttachment[]>(`/conversations/${conversationId}/attachments`, {
      query: { size: 100, ...(kind ? { kind } : {}) },
    })
  ).data;

export const deleteAttachmentRequest = (attachmentId: string) =>
  apiRequest<unknown>(`/attachments/${attachmentId}`, { method: "DELETE" });

/**
 * The file's bytes. The endpoint needs the bearer token, which an `<img src>` cannot send, so the bytes are fetched
 * here and shown from a blob URL.
 */
export async function fetchAttachmentBlob(downloadPath: string, signal?: AbortSignal): Promise<Blob> {
  if (!API_URL) throw new ApiError(0, "NOT_CONFIGURED", "The chat backend URL is not configured");
  await ensureFreshToken();
  const token = getAuthToken();
  let response: Response;
  try {
    response = await fetch(`${API_URL}${downloadPath}?inline=1`, {
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the chat backend");
  }
  if (!response.ok)
    throw new ApiError(response.status, "DOWNLOAD_FAILED", `Could not load the file (${response.status})`);
  return response.blob();
}
