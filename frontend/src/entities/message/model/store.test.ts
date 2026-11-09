import { beforeEach, describe, expect, it } from "vitest";
import { newestSequences, useMessageStore, type ChatMessage } from "./store";

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
  useMessageStore.setState({ byConversation: {}, typing: {}, history: {} });
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

describe("matching an optimistic message to its server copy", () => {
  it("replaces the message whose id is the client id, in place", () => {
    state().upsert(make("c-1", { side: "agent", status: "sending" }));
    state().upsert(make("c-2", { side: "agent", status: "sending" }));
    state().upsert(make("50", { side: "agent", status: "sent", clientId: "c-1", sequence: "7" }));
    expect(ids("a")).toEqual(["50", "c-2"]);
  });

  it("does not duplicate when the ack and a live copy of the same message both arrive", () => {
    state().upsert(make("c-1", { status: "sending" }));
    state().upsert(make("50", { clientId: "c-1", sequence: "7" }));
    state().upsert(make("50", { clientId: "c-1", sequence: "7", status: "read" }));
    expect(ids("a")).toEqual(["50"]);
    expect(state().byConversation.a?.[0]?.status).toBe("read");
  });

  it("shows another tab's message (same client id, not held here) as a new message", () => {
    state().upsert(make("50", { side: "agent", clientId: "c-9", sequence: "7" }));
    expect(ids("a")).toEqual(["50"]);
  });
});

describe("ordering by sequence", () => {
  it("inserts late arrivals in sequence order and keeps unsequenced (optimistic) messages last", () => {
    state().upsert(make("m5", { sequence: "5" }));
    state().upsert(make("c-1", { status: "sending" }));
    state().upsert(make("m3", { sequence: "3" }));
    state().upsert(make("m9", { sequence: "9" }));
    expect(ids("a")).toEqual(["m3", "m5", "m9", "c-1"]);
  });

  it("compares sequence numbers as numbers, not text", () => {
    state().upsert(make("m10", { sequence: "10" }));
    state().upsert(make("m9", { sequence: "9" }));
    expect(ids("a")).toEqual(["m9", "m10"]);
  });
});

describe("mergeMany", () => {
  it("keeps what is held, adds what is missing and dedupes", () => {
    state().upsert(make("m1", { sequence: "1" }));
    state().upsert(make("m4", { sequence: "4" }));
    state().mergeMany({
      a: [make("m2", { sequence: "2" }), make("m4", { sequence: "4", status: "read" })],
      b: [make("x1", { conversationId: "b", sequence: "1" })],
    });
    expect(ids("a")).toEqual(["m1", "m2", "m4"]);
    expect(state().byConversation.a?.[2]?.status).toBe("read");
    expect(ids("b")).toEqual(["x1"]);
  });

  it("does not drop other conversations or pending sends (unlike replaceAll)", () => {
    state().upsert(make("c-1", { status: "sending" }));
    state().upsert(make("z", { conversationId: "z" }));
    state().mergeMany({ a: [make("m1", { sequence: "1" })] });
    expect(ids("z")).toEqual(["z"]);
    expect(ids("a")).toEqual(["m1", "c-1"]);
  });
});

describe("history state and cursors", () => {
  it("tracks per-conversation history without touching other state", () => {
    state().setHistory("a", { loading: true });
    state().setHistory("a", { loaded: true, loading: false, hasMore: true, oldest: "4" });
    expect(state().history.a).toEqual({ loading: false, loaded: true, hasMore: true, oldest: "4" });
    expect(state().history.b).toBeUndefined();
  });

  it("reports the newest sequence per conversation and skips ones without any", () => {
    state().upsert(make("m1", { sequence: "9" }));
    state().upsert(make("m2", { sequence: "10" }));
    state().upsert(make("c-1", { conversationId: "b", status: "sending" }));
    expect(newestSequences(state().byConversation)).toEqual({ a: "10" });
  });
});

describe("message actions in the store", () => {
  const base = { conversationId: "a", side: "agent" as const, text: "t", createdAt: "2026-01-01T09:00:00Z" };

  it("removes a message and clears a reply aimed at it", () => {
    useMessageStore.setState({
      byConversation: {
        a: [
          { ...base, id: "m1" },
          { ...base, id: "m2" },
        ],
      },
      replyTarget: { a: "m1" },
    });
    useMessageStore.getState().remove("a", "m1");
    expect(useMessageStore.getState().byConversation.a?.map((m) => m.id)).toEqual(["m2"]);
    expect(useMessageStore.getState().replyTarget.a).toBeUndefined();
  });

  it("sets the reactions of one message only", () => {
    useMessageStore.setState({
      byConversation: {
        a: [
          { ...base, id: "m1" },
          { ...base, id: "m2" },
        ],
      },
    });
    useMessageStore.getState().setReactions("a", "m2", [{ id: "r", userId: "u", emoji: "👍" }]);
    expect(useMessageStore.getState().byConversation.a?.map((m) => m.reactions?.length ?? 0)).toEqual([0, 1]);
  });
});

describe("attachments in the store", () => {
  it("removes one file from its message and leaves the others", () => {
    const file = (id: string) => ({
      id,
      kind: "IMAGE" as const,
      fileName: id,
      mimeType: "image/png",
      size: 1,
      downloadPath: `/${id}`,
    });
    useMessageStore.setState({
      byConversation: {
        a: [
          {
            id: "m1",
            conversationId: "a",
            side: "agent",
            text: "",
            createdAt: "t",
            attachments: [file("f1"), file("f2")],
          },
          { id: "m2", conversationId: "a", side: "agent", text: "", createdAt: "t", attachments: [file("f3")] },
        ],
      },
    });
    useMessageStore.getState().removeAttachment("a", "f1");
    expect(useMessageStore.getState().byConversation.a?.map((m) => m.attachments?.map((f) => f.id))).toEqual([
      ["f2"],
      ["f3"],
    ]);
  });
});
