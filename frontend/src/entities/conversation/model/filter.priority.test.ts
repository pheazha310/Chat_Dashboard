import { describe, expect, it } from "vitest";
import { filterConversations } from "./filter";
import type { Conversation } from "./store";

const make = (id: string, patch: Partial<Conversation> = {}): Conversation => ({
  id,
  name: `Customer ${id}`,
  avatar: "",
  preview: "",
  lastMessageAt: "2026-01-01T09:00:00Z",
  unread: 0,
  urgent: false,
  handoff: "assigned",
  application: { appId: "1", product: "p", amount: "$1", tenor: "1m", status: "New", reference: "r" },
  activity: [],
  summary: "",
  ...patch,
});
const tag = (id: string) => ({ id, name: id, color: null });
const run = (
  list: Conversation[],
  extra: Parameters<typeof filterConversations>[1] extends infer T ? Partial<T> : never,
) => filterConversations(list, { filter: "all", query: "", me: null, ...extra }).map((c) => c.id);

describe("priority and tag filters", () => {
  const list = [
    make("a", { priority: "LOW", tags: [tag("vip")] }),
    make("b", { priority: "HIGH", urgent: true, tags: [tag("vip"), tag("docs")] }),
    make("c", { priority: "MEDIUM" }),
    make("d", { urgent: true }), // mock data: only the urgent flag
  ];

  it("keeps everything by default", () => {
    expect(run(list, {})).toEqual(["a", "b", "c", "d"]);
  });

  it("narrows by priority", () => {
    expect(run(list, { priority: "HIGH" })).toEqual(["b"]);
    expect(run(list, { priority: "LOW" })).toEqual(["a"]);
  });

  it("narrows by tag and combines with the other filters", () => {
    expect(run(list, { tag: "vip" })).toEqual(["a", "b"]);
    expect(run(list, { tag: "docs" })).toEqual(["b"]);
    expect(run(list, { tag: "vip", priority: "LOW" })).toEqual(["a"]);
    expect(run(list, { tag: "none" })).toEqual([]);
  });
});

describe("priority sort", () => {
  it("puts HIGH first and LOW last, keeping the incoming order inside each group", () => {
    const list = [
      make("l1", { priority: "LOW" }),
      make("h1", { priority: "HIGH" }),
      make("m1", { priority: "MEDIUM" }),
      make("h2", { priority: "HIGH" }),
      make("m2"), // no priority: treated as MEDIUM
      make("u", { urgent: true }), // no priority but urgent: treated as HIGH
    ];
    expect(run(list, { sort: "priority" })).toEqual(["h1", "h2", "u", "m1", "m2", "l1"]);
    expect(run(list, { sort: "recent" })).toEqual(["l1", "h1", "m1", "h2", "m2", "u"]);
  });
});
