import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/ws", () => ({ wsClient: { send } }));

import { useConversationStore, type Conversation } from "@/entities/conversation";
import { selectConversation } from "./selectConversation";

const make = (id: string, unread: number) => ({ id, unread }) as Conversation;

beforeEach(() => {
  send.mockClear();
  useConversationStore.setState({
    byId: { a: make("a", 2), b: make("b", 0) },
    order: ["a", "b"],
    selectedId: null,
    query: "",
  });
});

describe("selectConversation", () => {
  it("selects, clears unread locally and notifies the server", () => {
    selectConversation("a");
    expect(useConversationStore.getState().selectedId).toBe("a");
    expect(useConversationStore.getState().byId.a.unread).toBe(0);
    expect(send).toHaveBeenCalledWith("conversation.read", { conversationId: "a" });
  });

  it("does not notify the server when nothing was unread", () => {
    selectConversation("b");
    expect(useConversationStore.getState().selectedId).toBe("b");
    expect(send).not.toHaveBeenCalled();
  });
});
