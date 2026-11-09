import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  uploadFileRequest: vi.fn(),
  uploadVoiceRequest: vi.fn(),
  clearDraftRequest: vi.fn(() => Promise.resolve({})),
  saveDraftRequest: vi.fn(() => Promise.resolve({})),
  ApiError: class ApiError extends Error {},
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/api/ws", () => ({ wsClient: { send: vi.fn() }, isMockTransport: false }));
vi.mock("@/shared/ui", () => ({ notify }));
vi.mock("@/shared/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/config")>()),
  API_URL: "http://api",
}));

import { useMessageStore } from "@/entities/message";
import {
  chooseFile,
  clearChosenFile,
  hasChosenFile,
  MAX_FILE_BYTES,
  retryUpload,
  sendChosenFile,
  sendVoice,
  useUploadStore,
} from "./files";
import { retryMessage, useComposerStore } from "./store";

const file = (name = "scan.png", size = 10) => new File([new Uint8Array(size)], name, { type: "image/png" });
const stored = (patch = {}) => ({
  id: "srv-1",
  conversationId: "a",
  clientId: "",
  sequenceNumber: "5",
  senderType: "AGENT",
  senderId: "me",
  type: "IMAGE",
  content: null,
  status: "SENT",
  createdAt: "2026-01-01T09:00:00Z",
  attachments: [
    {
      id: "f1",
      conversationId: "a",
      messageId: "srv-1",
      kind: "IMAGE",
      fileName: "scan.png",
      mimeType: "image/png",
      fileSize: 10,
      durationMs: null,
      waveform: null,
      createdAt: "t",
      downloadPath: "/attachments/f1/download",
    },
  ],
  ...patch,
});
const messages = () => useMessageStore.getState().byConversation.a ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  useMessageStore.setState({ byConversation: {}, typing: {}, history: {}, replyTarget: {} });
  useComposerStore.setState({ drafts: {}, attachments: {}, recording: false });
  useUploadStore.setState({ progress: {} });
  clearChosenFile("a");
});

describe("choosing a file", () => {
  it("shows the file name as the attachment and refuses empty or oversized files", () => {
    expect(chooseFile("a", file("scan.png"))).toBeNull();
    expect(useComposerStore.getState().attachments.a).toBe("scan.png");
    expect(hasChosenFile("a")).toBe(true);
    expect(chooseFile("a", file("big.png", MAX_FILE_BYTES + 1))).toMatch(/25 MB/);
    expect(chooseFile("a", new File([], "empty.png"))).toMatch(/empty/);
    clearChosenFile("a");
    expect(hasChosenFile("a")).toBe(false);
    expect(useComposerStore.getState().attachments.a).toBe("");
  });
});

describe("sending a file", () => {
  it("shows a sending message at once, uploads the draft as caption, then swaps in the server copy", async () => {
    chooseFile("a", file());
    useComposerStore.getState().setDraft("a", "  ID photo ");
    let progress: ((n: number) => void) | undefined;
    rest.uploadFileRequest.mockImplementation(
      (_c: string, _f: File, options: { onProgress: (n: number) => void; clientId: string }) => {
        progress = options.onProgress;
        return new Promise((resolve) => setTimeout(() => resolve(stored({ clientId: options.clientId })), 0));
      },
    );

    expect(sendChosenFile("a")).toBe(true);
    expect(messages()).toMatchObject([{ side: "agent", text: "ID photo", status: "sending" }]);
    expect(useComposerStore.getState().drafts.a).toBe("");
    expect(hasChosenFile("a")).toBe(false);
    const clientId = messages()[0]!.id;
    progress?.(0.5);
    expect(useUploadStore.getState().progress[clientId]).toBe(0.5);

    await vi.waitFor(() => expect(messages()[0]?.status).not.toBe("sending"));
    expect(rest.uploadFileRequest).toHaveBeenCalledWith(
      "a",
      expect.any(File),
      expect.objectContaining({ clientId, text: "ID photo" }),
    );
    expect(messages()).toHaveLength(1); // replaced, not duplicated
    expect(messages()[0]).toMatchObject({
      id: "srv-1",
      clientId,
      attachments: [{ id: "f1", kind: "IMAGE", fileName: "scan.png" }],
    });
    expect(useUploadStore.getState().progress).toEqual({});
  });

  it("does nothing without a chosen file", () => {
    expect(sendChosenFile("a")).toBe(false);
    expect(rest.uploadFileRequest).not.toHaveBeenCalled();
  });

  it("marks the message failed, tells the agent why, and retries with the same client id", async () => {
    chooseFile("a", file());
    rest.uploadFileRequest.mockRejectedValueOnce(new Error("The file is too large"));
    sendChosenFile("a");
    const clientId = messages()[0]!.id;
    await vi.waitFor(() => expect(messages()[0]?.status).toBe("failed"));
    expect(notify).toHaveBeenCalledWith("The file is too large");
    expect(useUploadStore.getState().progress).toEqual({});

    rest.uploadFileRequest.mockResolvedValueOnce(stored({ clientId }));
    expect(retryMessage("a", clientId)).toBe(true);
    await vi.waitFor(() => expect(messages()[0]?.id).toBe("srv-1"));
    expect(rest.uploadFileRequest).toHaveBeenLastCalledWith(
      "a",
      expect.any(File),
      expect.objectContaining({ clientId }),
    );
    expect(retryUpload(clientId)).toBe(false); // sent, so nothing is left to retry
  });
});

describe("voice messages", () => {
  it("uploads the recording with its duration", async () => {
    rest.uploadVoiceRequest.mockResolvedValue(stored({ type: "VOICE" }));
    sendVoice("a", new File([new Uint8Array(5)], "voice-message.webm", { type: "audio/webm" }), 4210);
    expect(messages()[0]).toMatchObject({ text: "Voice message", status: "sending" });
    await vi.waitFor(() => expect(messages()[0]?.id).toBe("srv-1"));
    expect(rest.uploadVoiceRequest).toHaveBeenCalledWith(
      "a",
      expect.any(File),
      expect.objectContaining({ durationMs: 4210 }),
    );
  });

  it("keeps a failed voice message retryable", async () => {
    rest.uploadVoiceRequest.mockRejectedValueOnce(new Error("offline"));
    sendVoice("a", new File([new Uint8Array(5)], "v.webm", { type: "audio/webm" }), 1000);
    await vi.waitFor(() => expect(messages()[0]?.status).toBe("failed"));
    rest.uploadVoiceRequest.mockResolvedValueOnce(stored());
    expect(retryUpload(messages()[0]!.id)).toBe(true);
    await vi.waitFor(() => expect(messages()[0]?.id).toBe("srv-1"));
  });
});
