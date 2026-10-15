import { beforeEach, describe, expect, it } from "vitest";
import { useMessageStore, type ChatMessage } from "./store";

const make = (id: string, overrides: Partial<ChatMessage> = {}): ChatMessage =>
  ({
    id,
    conversationId: "a",
    side: "customer",
    text: id,
    createdAt: "2026-01-01T09:00:00Z",
    ...overrides,
  }) as ChatMessage;

const state = () => useMessageStore.getState();
const ids = (conversationId: string) => state().byConversation[conversationId]?.map((message) => message.id);

beforeEach(() => {
  useMessageStore.setState({ byConversation: {}, typing: {} });
});

describe("upsert", () => {
  it("appends new messages in arrival order", () => {
    state().upsert(make("1"));
    state().upsert(make("2"));
    expect(ids("a")).toEqual(["1", "2"]);
  });

  it("replaces an existing message in place (idempotent ack)", () => {
    state().upsert(make("1", { status: "sending" }));
    state().upsert(make("2"));
    state().upsert(make("1", { status: "sent" }));
    state().upsert(make("1", { status: "sent" }));
    expect(ids("a")).toEqual(["1", "2"]);
    expect(state().byConversation.a[0].status).toBe("sent");
  });
});

describe("replaceAll", () => {
  it("replaces server-known messages", () => {
    state().upsert(make("old", { status: "sent" }));
    state().replaceAll({ a: [make("new")] });
    expect(ids("a")).toEqual(["new"]);
  });

  it("keeps optimistic messages the server has not acknowledged", () => {
    state().upsert(make("local", { status: "sending" }));
    state().replaceAll({ a: [make("server")] });
    expect(ids("a")).toEqual(["server", "local"]);
  });

  it("does not duplicate an optimistic message the server already knows", () => {
    state().upsert(make("local", { status: "sending" }));
    state().replaceAll({ a: [make("local", { status: "sent" })] });
    expect(ids("a")).toEqual(["local"]);
  });
});

describe("setStatus", () => {
  it("updates only the targeted message", () => {
    state().upsert(make("1", { status: "sent" }));
    state().upsert(make("2", { status: "sent" }));
    state().setStatus("a", "2", "read");
    expect(state().byConversation.a.map((message) => message.status)).toEqual(["sent", "read"]);
  });
});

describe("setTyping", () => {
  it("sets and clears the typing side", () => {
    state().setTyping("a", "customer", true);
    expect(state().typing.a).toBe("customer");
    state().setTyping("a", "customer", false);
    expect(state().typing.a).toBeUndefined();
  });
});
