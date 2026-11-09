import { describe, expect, it } from "vitest";
import { toMessage } from "./mappers";
import type { BackendMessage } from "./types";

const source: BackendMessage = {
  id: "m1",
  conversationId: "a",
  clientId: null,
  sequenceNumber: "3",
  senderType: "AGENT",
  senderId: "u",
  type: "TEXT",
  content: "hi",
  status: "SENT",
  createdAt: "2026-01-01T09:00:00Z",
};

describe("toMessage with message actions", () => {
  it("maps reply, forward, edit and reactions", () => {
    const message = toMessage({
      ...source,
      replyToMessageId: "m0",
      forwardedFromMessageId: "m9",
      isEdited: true,
      reactions: [{ id: "r", userType: "AGENT", userId: "u", emoji: "👍", createdAt: "t" }],
    });
    expect(message).toMatchObject({
      replyToId: "m0",
      forwarded: true,
      edited: true,
      reactions: [{ id: "r", userId: "u", emoji: "👍" }],
    });
  });

  it("leaves the optional fields out of a plain message", () => {
    const message = toMessage({ ...source, replyToMessageId: null, isEdited: false, reactions: [] });
    expect(message).not.toHaveProperty("replyToId");
    expect(message).not.toHaveProperty("edited");
    expect(message).not.toHaveProperty("reactions");
  });
});

describe("toMessage with attachments", () => {
  it("maps files and drops empty metadata", () => {
    const message = toMessage({
      ...source,
      type: "VOICE",
      attachments: [
        {
          id: "f1",
          conversationId: "a",
          messageId: "m1",
          kind: "AUDIO",
          fileName: "voice.webm",
          mimeType: "audio/webm",
          fileSize: 900,
          durationMs: 4200,
          waveform: null,
          createdAt: "t",
          downloadPath: "/attachments/f1/download",
        },
      ],
    });
    expect(message.attachments).toEqual([
      {
        id: "f1",
        kind: "AUDIO",
        fileName: "voice.webm",
        mimeType: "audio/webm",
        size: 900,
        durationMs: 4200,
        downloadPath: "/attachments/f1/download",
      },
    ]);
    expect(toMessage({ ...source, attachments: [] })).not.toHaveProperty("attachments");
  });
});
