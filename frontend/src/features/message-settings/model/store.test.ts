import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    },
  });
});

import { useMessageSettingsStore as store } from "./store";

beforeEach(() => {
  store.setState({
    open: false,
    values: { conversationAlerts: true, typingSound: true, autoAssign: true, aiReplies: true, aiSummaries: true },
    trainingExamples: [],
    blockedCustomers: [],
    blockedKeywords: [],
  });
});

describe("message settings", () => {
  it("persists preferences but does not reopen the modal after reload", async () => {
    store.getState().toggle("aiReplies");
    store.getState().setOpen(true);
    const saved = JSON.parse(localStorage.getItem("chat-dashboard-message-settings")!);
    expect(saved.state.values.aiReplies).toBe(false);
    expect(saved.state.open).toBeUndefined();
    store.setState({ open: false, values: { ...store.getState().values, aiReplies: true } });
    localStorage.setItem("chat-dashboard-message-settings", JSON.stringify(saved));
    await store.persist.rehydrate();
    expect(store.getState().values.aiReplies).toBe(false);
    expect(store.getState().open).toBe(false);
  });

  it("saves both response templates", () => {
    store.getState().saveResponses("We are away", "Welcome");
    expect(store.getState().awayMessage).toBe("We are away");
    expect(store.getState().firstResponse).toBe("Welcome");
  });

  it("approves and revokes a training example", () => {
    store.getState().addExample("Hello", "Hi there");
    const id = store.getState().trainingExamples[0].id;
    store.getState().toggleApproval(id);
    expect(store.getState().trainingExamples[0].approved).toBe(true);
    store.getState().toggleApproval(id);
    expect(store.getState().trainingExamples[0].approved).toBe(false);
  });

  it("manages customer and keyword lists independently", () => {
    store.getState().setList("blockedCustomers", ["customer-1"]);
    store.getState().setList("blockedKeywords", ["spam"]);
    store.getState().setList("blockedCustomers", []);
    expect(store.getState().blockedCustomers).toEqual([]);
    expect(store.getState().blockedKeywords).toEqual(["spam"]);
  });
});
