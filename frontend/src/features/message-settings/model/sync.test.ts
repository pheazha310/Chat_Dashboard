import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateChatSettings, notify } = vi.hoisted(() => {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    },
  });
  return { updateChatSettings: vi.fn(), notify: vi.fn() };
});

vi.mock("@/shared/api/rest", () => ({ updateChatSettings }));
vi.mock("@/shared/api/ws", () => ({ isMockTransport: false }));
vi.mock("@/shared/config", () => ({ API_URL: "http://api.test" }));
vi.mock("@/shared/ui", () => ({ notify }));

import { useMessageSettingsStore as store } from "./store";

const allOn = { conversationAlerts: true, typingSound: true, autoAssign: true, aiReplies: true, aiSummaries: true };

beforeEach(() => {
  vi.resetAllMocks();
  updateChatSettings.mockResolvedValue({});
  store.setState({ values: { ...allOn } });
});

describe("chat settings synced with the backend", () => {
  it("saves a changed switch under its backend name", () => {
    store.getState().toggle("aiReplies");
    expect(updateChatSettings).toHaveBeenCalledWith({ aiSuggestionsEnabled: false });
    store.getState().toggle("autoAssign");
    expect(updateChatSettings).toHaveBeenLastCalledWith({ autoAssignEnabled: false });
    store.getState().toggle("typingSound");
    expect(updateChatSettings).toHaveBeenLastCalledWith({ typingSoundEnabled: false });
    store.getState().toggle("aiSummaries");
    expect(updateChatSettings).toHaveBeenLastCalledWith({ aiSummariesEnabled: false });
  });

  it("keeps new conversation alerts in this browser only", () => {
    store.getState().toggle("conversationAlerts");
    expect(store.getState().values.conversationAlerts).toBe(false);
    expect(updateChatSettings).not.toHaveBeenCalled();
  });

  it("puts the switch back and says so when the server refuses", async () => {
    updateChatSettings.mockRejectedValue(new Error("503"));
    store.getState().toggle("typingSound");
    expect(store.getState().values.typingSound).toBe(false);
    await vi.waitFor(() => expect(store.getState().values.typingSound).toBe(true));
    expect(notify).toHaveBeenCalledWith("Could not save your setting");
  });

  it("does not undo a later change when an earlier save fails", async () => {
    let failFirst: (reason: Error) => void = () => {};
    updateChatSettings
      .mockReturnValueOnce(new Promise((_resolve, reject) => (failFirst = reject)))
      .mockResolvedValue({});
    store.getState().toggle("typingSound"); // off, the save is still pending
    store.getState().toggle("typingSound"); // on
    store.getState().toggle("typingSound"); // off again
    failFirst(new Error("503"));
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(store.getState().values.typingSound).toBe(false);
  });

  it("takes the saved switches from the backend, leaving the browser-only one alone", () => {
    store.getState().toggle("conversationAlerts");
    store.getState().applyRemote({
      typingSoundEnabled: false,
      notificationSoundEnabled: true,
      aiSuggestionsEnabled: false,
      aiSummariesEnabled: true,
      autoAssignEnabled: false,
    });
    expect(store.getState().values).toEqual({
      conversationAlerts: false,
      typingSound: false,
      autoAssign: false,
      aiReplies: false,
      aiSummaries: true,
    });
  });
});
