import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  searchMessages: vi.fn(),
  getMessages: vi.fn(),
  loadUntil: vi.fn(),
  mock: { value: false },
}));
vi.mock("@/shared/api/rest", () => ({ searchMessages: api.searchMessages, getMessages: api.getMessages }));
vi.mock("@/shared/api/ws", () => ({
  get isMockTransport() {
    return api.mock.value;
  },
}));
vi.mock("@/entities/message", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/entities/message")>()),
  loadUntil: api.loadUntil,
}));
vi.mock("@/shared/ui", () => ({ notify: vi.fn() }));

import { useMessageStore, type ChatMessage } from "@/entities/message";
import { useSessionStore } from "@/shared/api/session";
import { notify } from "@/shared/ui";
import { jumpToDate, runSearch, step, useChatSearchStore } from "./store";

const hit = (sequence: number) => ({
  id: `m${sequence}`,
  sequenceNumber: String(sequence),
  content: `salary ${sequence}`,
});
const message = (id: string, text: string, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  conversationId: "a",
  side: "customer",
  text,
  createdAt: "t",
  ...patch,
});
const search = () => useChatSearchStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  api.mock.value = false;
  api.loadUntil.mockResolvedValue(true);
  useChatSearchStore.setState({ open: true, query: "", hits: [], active: 0, searching: false, hasMore: false });
  useMessageStore.setState({ byConversation: {} });
});

describe("runSearch", () => {
  it("asks the server, starts at the newest hit and loads the thread back to it", async () => {
    api.searchMessages.mockResolvedValue({ items: [hit(9), hit(3)], hasMore: false });
    await runSearch("a", " salary ");
    expect(api.searchMessages).toHaveBeenCalledWith("a", "salary");
    expect(search()).toMatchObject({
      hits: [
        { id: "m9", sequence: "9" },
        { id: "m3", sequence: "3" },
      ],
      active: 0,
    });
    expect(search().searching).toBe(false);
    expect(api.loadUntil).toHaveBeenCalledWith("a", "9");
    expect(search().focus).toMatchObject({ id: "m9" });
  });

  it("ignores an answer for a query the agent has already replaced", async () => {
    let finishOld!: (value: unknown) => void;
    api.searchMessages
      .mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)))
      .mockResolvedValueOnce({ items: [hit(5)], hasMore: false });
    const old = runSearch("a", "sal");
    await runSearch("a", "salary");
    finishOld({ items: [hit(1)], hasMore: false });
    await old;
    expect(search().hits.map((h) => h.id)).toEqual(["m5"]);
  });

  it("clears the results for a blank query without asking the server", async () => {
    useChatSearchStore.setState({ hits: [{ id: "x", sequence: "1" }] });
    await runSearch("a", "   ");
    expect(api.searchMessages).not.toHaveBeenCalled();
    expect(search().hits).toEqual([]);
  });

  it("reports a failed search", async () => {
    api.searchMessages.mockRejectedValue(new Error("down"));
    await runSearch("a", "salary");
    expect(notify).toHaveBeenCalledWith("Search failed, please try again");
    expect(search()).toMatchObject({ hits: [], searching: false });
  });

  it("with the mock transport searches the messages held, any case, skipping deleted and system notes", async () => {
    api.mock.value = true;
    useMessageStore.setState({
      byConversation: {
        a: [
          message("1", "My SALARY is 1,200"),
          message("2", "salary", { deleted: true }),
          message("3", "Agent took over: salary", { side: "system" }),
          message("4", "hello"),
          message("5", "salary slip"),
        ],
      },
    });
    await runSearch("a", "Salary");
    expect(api.searchMessages).not.toHaveBeenCalled();
    expect(search().hits.map((h) => h.id)).toEqual(["5", "1"]);
  });
});

describe("recent searches", () => {
  const useSearch = async (query: string) => {
    api.searchMessages.mockResolvedValue({ items: [hit(9), hit(3)], hasMore: false });
    useChatSearchStore.setState({ open: true, query });
    await runSearch("a", query);
    await step("a", 1);
  };

  beforeEach(() => useChatSearchStore.setState({ recent: [] }));

  it("remembers a search once it is used (stepping through or closing with matches), newest first, at most 5", async () => {
    for (const query of ["one", "two", "three", "four", "five", "six"]) await useSearch(query);
    await useSearch(" TWO ");
    expect(search().recent).toEqual(["TWO", "six", "five", "four", "three"]);

    api.searchMessages.mockResolvedValue({ items: [hit(1)], hasMore: false });
    useChatSearchStore.setState({ query: "seven" });
    await runSearch("a", "seven");
    expect(search().recent[0]).toBe("TWO"); // only typed, not used yet
    search().close();
    expect(search().recent[0]).toBe("seven");
  });

  it("does not remember a search without matches", async () => {
    api.searchMessages.mockResolvedValue({ items: [], hasMore: false });
    useChatSearchStore.setState({ query: "nothing" });
    await runSearch("a", "nothing");
    search().close();
    expect(search().recent).toEqual([]);
  });

  it("forgets them when the agent signs out or another agent signs in", async () => {
    useSessionStore.getState().set({ userId: "u1", role: "AGENT" });
    await useSearch("salary");
    useSessionStore.getState().set({ userId: null, role: null });
    expect(search().recent).toEqual([]);
  });
});

describe("jumpToDate", () => {
  it("asks for the first message on or after local midnight of that day and shows it", async () => {
    api.getMessages.mockResolvedValue({ items: [{ id: "m40", sequenceNumber: "40" }], meta: {} });
    await jumpToDate("a", "2026-10-03");
    expect(api.getMessages).toHaveBeenCalledWith("a", {
      from: new Date(2026, 9, 3).toISOString(),
      limit: 1,
    });
    expect(api.loadUntil).toHaveBeenCalledWith("a", "40");
    expect(search().focus).toMatchObject({ conversationId: "a", id: "m40" });
  });

  it("says so when nothing was written on or after that day", async () => {
    api.getMessages.mockResolvedValue({ items: [], meta: {} });
    await jumpToDate("a", "2030-01-01");
    expect(notify).toHaveBeenCalledWith("No messages on or after that day");
    expect(api.loadUntil).not.toHaveBeenCalled();
  });

  it("with the mock transport picks the first held message of that day", async () => {
    api.mock.value = true;
    useMessageStore.setState({
      byConversation: {
        a: [
          message("1", "old", { createdAt: new Date(2026, 9, 1, 9).toISOString() }),
          message("2", "that day", { createdAt: new Date(2026, 9, 3, 8).toISOString() }),
        ],
      },
    });
    await jumpToDate("a", "2026-10-02");
    expect(api.getMessages).not.toHaveBeenCalled();
    expect(search().focus).toMatchObject({ id: "2" });
  });
});

describe("step", () => {
  beforeEach(async () => {
    api.searchMessages.mockResolvedValue({ items: [hit(9), hit(6), hit(3)], hasMore: false });
    await runSearch("a", "salary");
    api.loadUntil.mockClear();
  });

  it("goes to older results and back to newer ones, stopping at the ends", async () => {
    await step("a", 1);
    expect(search().active).toBe(1);
    expect(api.loadUntil).toHaveBeenLastCalledWith("a", "6");
    await step("a", 1);
    await step("a", 1);
    expect(search().active).toBe(2);
    await step("a", -1);
    expect(search()).toMatchObject({ active: 1, focus: { id: "m6" } });
    await step("a", -1);
    await step("a", -1);
    expect(search().active).toBe(0);
  });
});
