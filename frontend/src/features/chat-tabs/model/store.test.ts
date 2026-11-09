import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  openTabRequest: vi.fn((_id: string) => Promise.resolve({})),
  closeTabRequest: vi.fn((_id: string) => Promise.resolve({})),
}));
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/config")>()),
  API_URL: "http://api",
}));

import { closeTab, openTab, useChatTabsStore } from "./store";

beforeEach(() => {
  rest.openTabRequest.mockClear();
  rest.closeTabRequest.mockClear();
  useChatTabsStore.setState({ openIds: [] });
});

describe("chat tabs", () => {
  it("never opens the same conversation twice", () => {
    openTab("a");
    openTab("a");
    useChatTabsStore.getState().add("a");
    expect(useChatTabsStore.getState().openIds).toEqual(["a"]);
    expect(rest.openTabRequest).toHaveBeenCalledTimes(1);
  });

  it("drops duplicates when restoring", () => {
    useChatTabsStore.getState().setTabs(["a", "b", "a"]);
    expect(useChatTabsStore.getState().openIds).toEqual(["a", "b"]);
  });

  it("closing a tab returns the neighbour to show and saves only the tab removal", () => {
    useChatTabsStore.getState().setTabs(["a", "b", "c"]);
    expect(closeTab("b")).toBe("c");
    expect(closeTab("c")).toBe("a");
    expect(closeTab("a")).toBeNull();
    expect(closeTab("zzz")).toBeNull();
    expect(rest.closeTabRequest.mock.calls.map(([id]) => id)).toEqual(["b", "c", "a"]);
  });

  it("keeps the tab list usable when saving fails", async () => {
    rest.openTabRequest.mockRejectedValueOnce(new Error("offline"));
    openTab("a");
    await Promise.resolve();
    expect(useChatTabsStore.getState().openIds).toEqual(["a"]);
  });
});
