import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  searchAllMessages: vi.fn(),
  loadUntil: vi.fn(),
  loadUntilMessage: vi.fn(),
  mock: { value: false },
}));
vi.mock("@/shared/api/rest", () => ({ searchAllMessages: api.searchAllMessages }));
vi.mock("@/shared/api/ws", () => ({
  get isMockTransport() {
    return api.mock.value;
  },
}));
vi.mock("@/entities/message", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/entities/message")>()),
  loadUntil: api.loadUntil,
  loadUntilMessage: api.loadUntilMessage,
}));
vi.mock("@/shared/ui", () => ({ notify: vi.fn() }));

import { useConversationStore } from "@/entities/conversation";
import { useMessageStore, type ChatMessage } from "@/entities/message";
import { searchEverywhere, useInboxSearchStore } from "./inbox";
import { showMessage, useChatSearchStore } from "./store";

const serverHit = (id: string, conversationId: string, customerName: string | null, content: string) => ({
  message: { id, conversationId, sequenceNumber: "7", content, createdAt: "2026-10-03T09:00:00.000Z" },
  conversation: { id: conversationId, customerName, customerIdentifier: "012 345" },
});
const held = (id: string, conversationId: string, text: string, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  conversationId,
  side: "customer",
  text,
  createdAt: "t",
  ...patch,
});
const results = () => useInboxSearchStore.getState().results;

beforeEach(() => {
  vi.clearAllMocks();
  api.mock.value = false;
  api.loadUntil.mockResolvedValue(true);
  api.loadUntilMessage.mockResolvedValue(true);
  useInboxSearchStore.setState({ results: [], hasMore: false, searching: false });
  useMessageStore.setState({ byConversation: {} });
});

describe("searchEverywhere", () => {
  it("asks the server and lists each hit under its customer", async () => {
    api.searchAllMessages.mockResolvedValue({
      items: [serverHit("m1", "c1", "Sok Dara", "salary slip"), serverHit("m2", "c2", null, "my salary")],
      hasMore: true,
    });
    await searchEverywhere(" salary ");
    expect(api.searchAllMessages).toHaveBeenCalledWith("salary");
    expect(results()).toEqual([
      {
        messageId: "m1",
        conversationId: "c1",
        sequence: "7",
        customer: "Sok Dara",
        text: "salary slip",
        createdAt: "2026-10-03T09:00:00.000Z",
      },
      expect.objectContaining({ messageId: "m2", customer: "012 345" }),
    ]);
    expect(useInboxSearchStore.getState()).toMatchObject({ hasMore: true, searching: false });
  });

  it("ignores an answer for a query the agent already replaced, and clears on a blank query", async () => {
    let finishOld!: (value: unknown) => void;
    api.searchAllMessages
      .mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)))
      .mockResolvedValueOnce({ items: [serverHit("new", "c1", "A", "salary")], hasMore: false });
    const old = searchEverywhere("sal");
    await searchEverywhere("salary");
    finishOld({ items: [serverHit("old", "c1", "A", "sal")], hasMore: false });
    await old;
    expect(results().map((r) => r.messageId)).toEqual(["new"]);
    await searchEverywhere("  ");
    expect(results()).toEqual([]);
  });

  it("with the mock transport matches word starts in every held conversation, newest first", async () => {
    api.mock.value = true;
    useConversationStore.setState({
      byId: { c1: { id: "c1", name: "Sok Dara" }, c2: { id: "c2", name: "Lim Sophea" } } as never,
    });
    useMessageStore.setState({
      byConversation: {
        c1: [held("1", "c1", "Your SALARY slip", { createdAt: "2026-01-01T09:00:00Z" })],
        c2: [
          held("2", "c2", "my salary is late", { createdAt: "2026-01-02T09:00:00Z" }),
          held("3", "c2", "nosalary here"),
          held("4", "c2", "salary", { side: "system" }),
        ],
      },
    });
    await searchEverywhere("sal");
    expect(results().map((r) => [r.customer, r.text])).toEqual([
      ["Lim Sophea", "my salary is late"],
      ["Sok Dara", "Your SALARY slip"],
    ]);
  });
});

describe("showMessage", () => {
  it("loads the conversation back to the message, then asks that chat to scroll to it", async () => {
    await showMessage("c1", { id: "m1", sequence: "7" });
    expect(api.loadUntil).toHaveBeenCalledWith("c1", "7");
    expect(useChatSearchStore.getState().focus).toMatchObject({ conversationId: "c1", id: "m1" });
  });

  it("finds a message known only by id (a shared file), and does not jump when it cannot be found", async () => {
    await showMessage("c1", { id: "m2" });
    expect(api.loadUntilMessage).toHaveBeenCalledWith("c1", "m2");
    expect(useChatSearchStore.getState().focus).toMatchObject({ id: "m2" });
    api.loadUntilMessage.mockResolvedValue(false);
    await showMessage("c1", { id: "gone" });
    expect(useChatSearchStore.getState().focus).toMatchObject({ id: "m2" });
  });
});
