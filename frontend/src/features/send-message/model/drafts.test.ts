import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  saveDraftRequest: vi.fn((_id: string, _text: string) => Promise.resolve({})),
  clearDraftRequest: vi.fn((_id: string) => Promise.resolve({})),
}));
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/api/ws", () => ({ wsClient: { send: vi.fn() }, isMockTransport: false }));
vi.mock("@/shared/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/config")>()),
  API_URL: "http://api",
}));

import { applyRemoteDraft, hydrateDrafts, insertIntoDraft, sendMessage, updateDraft, useComposerStore } from "./store";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T09:00:00Z"));
  rest.saveDraftRequest.mockClear();
  rest.clearDraftRequest.mockClear();
  useComposerStore.setState({ drafts: {}, attachments: {}, recording: false });
});
afterEach(() => vi.useRealTimers());

describe("draft sync", () => {
  it("saves once after typing stops, with the latest text", () => {
    updateDraft("a", "He");
    updateDraft("a", "Hello");
    expect(useComposerStore.getState().drafts.a).toBe("Hello");
    vi.advanceTimersByTime(900);
    expect(rest.saveDraftRequest).toHaveBeenCalledTimes(1);
    expect(rest.saveDraftRequest).toHaveBeenCalledWith("a", "Hello");
  });

  it("keeps drafts of different conversations apart", () => {
    updateDraft("a", "for a");
    updateDraft("b", "for b");
    vi.advanceTimersByTime(900);
    expect(rest.saveDraftRequest.mock.calls).toEqual([
      ["a", "for a"],
      ["b", "for b"],
    ]);
  });

  it("discards the pending save and the stored draft when the message is sent", () => {
    updateDraft("a", "Hello");
    sendMessage("a", "Hello");
    vi.advanceTimersByTime(900);
    expect(rest.saveDraftRequest).not.toHaveBeenCalled();
    expect(rest.clearDraftRequest).toHaveBeenCalledWith("a");
    expect(useComposerStore.getState().drafts.a).toBe("");
  });

  it("restores server drafts without overwriting text typed in this window", () => {
    useComposerStore.getState().setDraft("a", "typing now");
    hydrateDrafts([
      { conversationId: "a", content: "old" },
      { conversationId: "b", content: "restored" },
    ]);
    expect(useComposerStore.getState().drafts).toMatchObject({ a: "typing now", b: "restored" });
  });

  it("applies a newer draft from another window but ignores one older than the local edit", () => {
    updateDraft("a", "mine");
    applyRemoteDraft("a", "stale", "2025-12-31T23:59:59Z");
    expect(useComposerStore.getState().drafts.a).toBe("mine");
    applyRemoteDraft("a", "newer", "2026-01-01T09:00:05Z");
    expect(useComposerStore.getState().drafts.a).toBe("newer");
    applyRemoteDraft("a", null, "2026-01-01T09:00:06Z");
    expect(useComposerStore.getState().drafts.a).toBe("");
  });
});

describe("inserting a saved reply", () => {
  it("fills an empty draft, or goes on a new line after existing text, and sends nothing", () => {
    insertIntoDraft("a", "Hello Maya");
    expect(useComposerStore.getState().drafts.a).toBe("Hello Maya");
    insertIntoDraft("a", "Thanks for waiting");
    expect(useComposerStore.getState().drafts.a).toBe("Hello Maya\nThanks for waiting");
    useComposerStore.getState().setDraft("b", "typed  \n");
    insertIntoDraft("b", "Reply");
    expect(useComposerStore.getState().drafts.b).toBe("typed\nReply");
    useComposerStore.getState().setDraft("c", "   ");
    insertIntoDraft("c", "Only reply");
    expect(useComposerStore.getState().drafts.c).toBe("Only reply");
  });

  it("is saved like any other edit, so the agent can change it before sending", () => {
    insertIntoDraft("a", "Hello");
    vi.advanceTimersByTime(900);
    expect(rest.saveDraftRequest).toHaveBeenCalledWith("a", "Hello");
  });
});
