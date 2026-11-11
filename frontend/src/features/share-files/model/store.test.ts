import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ listAttachments: vi.fn() }));
vi.mock("@/shared/api/rest", () => ({ listAttachments: api.listAttachments }));
vi.mock("@/shared/config", () => ({ API_URL: "http://api.test" }));

import { useSharedFilesStore } from "./store";

beforeEach(() => useSharedFilesStore.setState({ filter: "All" }));

describe("useSharedFilesStore", () => {
  it("adds an uploaded image first, classified as Image", () => {
    const file = new File([new Uint8Array(4096)], "id.png", { type: "image/png" });
    useSharedFilesStore.getState().add(file);
    expect(useSharedFilesStore.getState().files[0]).toMatchObject({ name: "id.png", kind: "Image", size: "4 KB" });
  });

  it("classifies non-images as Document and reports at least 1 KB", () => {
    useSharedFilesStore.getState().add(new File(["x"], "note.pdf", { type: "application/pdf" }));
    expect(useSharedFilesStore.getState().files[0]).toMatchObject({ kind: "Document", size: "1 KB" });
  });

  it("loads the conversation's files and remembers the message each came with (for Show in chat)", async () => {
    api.listAttachments.mockResolvedValue([
      {
        id: "f1",
        messageId: "m7",
        kind: "DOCUMENT",
        fileName: "contract.pdf",
        fileSize: 2048,
        createdAt: "2026-10-03T09:00:00.000Z",
        downloadPath: "/attachments/f1",
      },
    ]);
    await useSharedFilesStore.getState().load("c1");
    expect(useSharedFilesStore.getState().files).toEqual([
      expect.objectContaining({ id: "f1", name: "contract.pdf", kind: "Document", messageId: "m7" }),
    ]);
  });

  it("changes the filter", () => {
    useSharedFilesStore.getState().setFilter("Images");
    expect(useSharedFilesStore.getState().filter).toBe("Images");
  });
});
