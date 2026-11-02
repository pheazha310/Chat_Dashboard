import { beforeEach, describe, expect, it } from "vitest";
import { useConversationStore, type Conversation } from "./store";

const make = (id: string, overrides: Partial<Conversation> = {}): Conversation =>
  ({
    id,
    name: id,
    avatar: "/assets/avatar.png",
    preview: "",
    lastMessageAt: "2026-01-01T09:00:00Z",
    unread: 0,
    urgent: false,
    handoff: "ai",
    application: {
      appId: "61801",
      product: "Instant Cash",
      amount: "$500",
      tenor: "30 days",
      status: "in progress",
      reference: "REF-001",
    },
    activity: [],
    summary: "",
    ...overrides,
  }) as Conversation;

const state = () => useConversationStore.getState();

beforeEach(() => {
  useConversationStore.setState({
    byId: {},
    order: [],
    selectedId: null,
    query: "",
  });
});

describe("setAll", () => {
  it("selects the first conversation when nothing is selected", () => {
    state().setAll([make("a"), make("b")]);
    expect(state().selectedId).toBe("a");
    expect(state().order).toEqual(["a", "b"]);
  });

  it("keeps the selection when it survives a refresh", () => {
    state().setAll([make("a"), make("b")]);
    state().select("b");
    state().setAll([make("a"), make("b")]);
    expect(state().selectedId).toBe("b");
  });

  it("falls back to the first conversation when the selection disappears", () => {
    state().setAll([make("a"), make("b")]);
    state().select("b");
    state().setAll([make("a")]);
    expect(state().selectedId).toBe("a");
  });

  it("clears the selection for an empty list", () => {
    state().setAll([]);
    expect(state().selectedId).toBeNull();
  });
});

describe("upsert", () => {
  it("moves a new conversation to the top", () => {
    state().setAll([make("a")]);
    state().upsert(make("b"));
    expect(state().order).toEqual(["b", "a"]);
  });

  it("moves a conversation to the top when lastMessageAt changes", () => {
    state().setAll([make("a"), make("b")]);
    state().upsert(make("b", { lastMessageAt: "2026-01-01T10:00:00Z" }));
    expect(state().order).toEqual(["b", "a"]);
  });

  it("keeps the order for updates without a new message", () => {
    state().setAll([make("a"), make("b")]);
    state().upsert(make("b", { unread: 3 }));
    expect(state().order).toEqual(["a", "b"]);
    expect(state().byId.b.unread).toBe(3);
  });
});

describe("select", () => {
  it("ignores unknown ids", () => {
    state().setAll([make("a")]);
    state().select("missing");
    expect(state().selectedId).toBe("a");
  });
});

describe("markReadLocally", () => {
  it("resets unread to 0", () => {
    state().setAll([make("a", { unread: 2 })]);
    state().markReadLocally("a");
    expect(state().byId.a.unread).toBe(0);
  });

  it("does not change state when already read or unknown", () => {
    state().setAll([make("a")]);
    const before = state().byId;
    state().markReadLocally("a");
    state().markReadLocally("missing");
    expect(state().byId).toBe(before);
  });
});

describe("local conversation actions", () => {
  it("marks unread without reducing existing unread messages", () => {
    state().setAll([make("a"), make("b", { unread: 3 })]);
    state().markUnreadLocally("a");
    state().markUnreadLocally("b");
    expect(state().byId.a.unread).toBe(1);
    expect(state().byId.b.unread).toBe(3);
  });

  it("assigns the conversation to you", () => {
    state().setAll([make("a", { handoff: "needs-human" })]);
    state().assignToMeLocally("a");
    expect(state().byId.a.handoff).toBe("assigned");
    expect(state().byId.a.assignedAgent?.name).toBe("You");
  });

  it("keeps archived data and selects the next unarchived conversation", () => {
    state().setAll([make("a"), make("b"), make("c")]);
    state().archiveLocally("b");
    expect(state().selectedId).toBe("a");
    state().archiveLocally("a");
    expect(state().selectedId).toBe("c");
    expect(state().byId.a.archived).toBe(true);
    expect(state().byId.a.name).toBe("a");
    state().archiveLocally("c");
    expect(state().selectedId).toBeNull();
  });

  it("ignores unknown conversations", () => {
    state().setAll([make("a")]);
    const before = state().byId;
    state().markUnreadLocally("missing");
    state().assignToMeLocally("missing");
    state().archiveLocally("missing");
    expect(state().byId).toBe(before);
  });
});
