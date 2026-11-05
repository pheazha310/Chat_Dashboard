import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getMessages: vi.fn(), mock: { value: false } }));
vi.mock("@/shared/api/rest", () => ({ getMessages: api.getMessages }));
vi.mock("@/shared/api/ws", () => ({
  get isMockTransport() {
    return api.mock.value;
  },
}));
vi.mock("@/shared/ui", () => ({ notify: vi.fn() }));

import { notify } from "@/shared/ui";
import { catchUp, loadHistory, loadOlderMessages } from "./history";
import { useMessageStore } from "./store";

const backendMessage = (sequence: number) => ({
  id: String(sequence),
  conversationId: "a",
  clientId: null,
  sequenceNumber: String(sequence),
  senderType: "CUSTOMER",
  senderId: "100",
  type: "TEXT",
  content: `m${sequence}`,
  status: "SENT",
  createdAt: "2026-01-01T09:00:00.000Z",
});
const page = (sequences: number[], hasMore: boolean) => ({
  items: sequences.map(backendMessage),
  meta: {
    limit: 50,
    hasMore,
    direction: "older",
    oldestSequence: String(sequences[0] ?? ""),
    newestSequence: String(sequences.at(-1) ?? ""),
  },
});
const ids = () => useMessageStore.getState().byConversation.a?.map((m) => m.id);

beforeEach(() => {
  vi.clearAllMocks();
  api.mock.value = false;
  useMessageStore.setState({ byConversation: {}, typing: {}, history: {} });
});

describe("loadHistory", () => {
  it("loads the newest page once, in order, and remembers how to page back", async () => {
    api.getMessages.mockResolvedValue(page([8, 9, 10], true));
    await loadHistory("a");
    expect(api.getMessages).toHaveBeenCalledWith("a", { limit: 50 });
    expect(ids()).toEqual(["8", "9", "10"]);
    expect(useMessageStore.getState().history.a).toEqual({ loading: false, loaded: true, hasMore: true, oldest: "8" });
    await loadHistory("a");
    expect(api.getMessages).toHaveBeenCalledTimes(1);
  });

  it("does not start a second request while one is running", async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    api.getMessages.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const first = loadHistory("a");
    await loadHistory("a");
    expect(api.getMessages).toHaveBeenCalledTimes(1);
    finish(page([1], false));
    await first;
  });

  it("keeps live messages that arrived while the page was loading", async () => {
    api.getMessages.mockImplementation(async () => {
      useMessageStore
        .getState()
        .upsert({ id: "11", conversationId: "a", side: "customer", text: "live", createdAt: "t", sequence: "11" });
      return page([9, 10], false);
    });
    await loadHistory("a");
    expect(ids()).toEqual(["9", "10", "11"]);
  });

  it("reports a failure and allows a retry", async () => {
    api.getMessages.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(page([1], false));
    await loadHistory("a");
    expect(notify).toHaveBeenCalledWith("Could not load the conversation history");
    expect(useMessageStore.getState().history.a).toMatchObject({ loading: false, loaded: false });
    await loadHistory("a");
    expect(ids()).toEqual(["1"]);
  });

  it("does nothing with the mock transport (messages arrive in sync)", async () => {
    api.mock.value = true;
    await loadHistory("a");
    expect(api.getMessages).not.toHaveBeenCalled();
  });
});

describe("loadOlderMessages", () => {
  it("pages back from the oldest sequence held and stops when there is no more", async () => {
    api.getMessages.mockResolvedValueOnce(page([8, 9, 10], true)).mockResolvedValueOnce(page([5, 6, 7], false));
    await loadHistory("a");
    await loadOlderMessages("a");
    expect(api.getMessages).toHaveBeenLastCalledWith("a", { before: "8", limit: 50 });
    expect(ids()).toEqual(["5", "6", "7", "8", "9", "10"]);
    expect(useMessageStore.getState().history.a).toMatchObject({ hasMore: false, oldest: "5" });
    await loadOlderMessages("a");
    expect(api.getMessages).toHaveBeenCalledTimes(2);
  });

  it("does nothing before the first page has loaded", async () => {
    await loadOlderMessages("a");
    expect(api.getMessages).not.toHaveBeenCalled();
  });
});

describe("catchUp", () => {
  it("pages through everything after the newest message held", async () => {
    useMessageStore
      .getState()
      .upsert({ id: "5", conversationId: "a", side: "customer", text: "", createdAt: "t", sequence: "5" });
    api.getMessages.mockResolvedValueOnce(page([6, 7], true)).mockResolvedValueOnce(page([8], false));
    await catchUp("a");
    expect(api.getMessages).toHaveBeenNthCalledWith(1, "a", { after: "5", limit: 100 });
    expect(api.getMessages).toHaveBeenNthCalledWith(2, "a", { after: "7", limit: 100 });
    expect(ids()).toEqual(["5", "6", "7", "8"]);
  });

  it("skips conversations it holds nothing for, and gives up quietly on errors", async () => {
    await catchUp("a");
    expect(api.getMessages).not.toHaveBeenCalled();
    useMessageStore
      .getState()
      .upsert({ id: "5", conversationId: "a", side: "customer", text: "", createdAt: "t", sequence: "5" });
    api.getMessages.mockRejectedValue(new Error("down"));
    await expect(catchUp("a")).resolves.toBeUndefined();
  });
});
