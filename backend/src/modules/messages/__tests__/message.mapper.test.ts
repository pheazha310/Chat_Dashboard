import { describe, expect, it } from "vitest";
import { toAttachment } from "../message.mapper.js";
import type { AttachmentRow } from "../message.types.js";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  uploadedByType: "AGENT",
  uploadedById: "33333333-3333-4333-8333-333333333333",
  storageKey: "conversations/22222222-2222-4222-8222-222222222222/abc.png",
  fileName: "photo.png",
  mimeType: "image/png",
  fileSize: 10n,
  durationMs: null,
  waveform: null,
  checksumSha256: null,
  uploadStatus: "READY",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
} as AttachmentRow;

describe("toAttachment", () => {
  it("returns the storage path (no bucket, host or signed URL) as filePath", () => {
    const dto = toAttachment(row);
    expect(dto.filePath).toBe(row.storageKey);
    expect(dto.filePath).not.toMatch(/^[a-z]+:\/\//i);
  });
});
