import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/ws", () => ({ wsClient: { send } }));

import { useConversationStore, type Conversation } from "@/entities/conversation";
import { markConversationUnread } from "./markUnread";

beforeEach(() => {
  send.mockClear();
  useConversationStore.setState({
    byId: { a: { id: "a", unread: 0 } as Conversation },
    order: ["a"],
    selectedId: "a",
    query: "",
    filter: "all",
  });
});

describe("markConversationUnread", () => {
  it("shows the conversation unread at once and tells the server so other sessions see it", () => {
    markConversationUnread("a");
    expect(useConversationStore.getState().byId.a?.unread).toBe(1);
    expect(send).toHaveBeenCalledWith("conversation.unread", { conversationId: "a" });
  });
});
