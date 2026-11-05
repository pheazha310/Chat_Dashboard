import { describe, expect, it } from "vitest";
import { filterConversations } from "./filter";
import type { Conversation } from "./store";

const make = (id: string, patch: Partial<Conversation> = {}) =>
  ({
    id,
    name: `Customer ${id}`,
    preview: `hello ${id}`,
    unread: 0,
    handoff: "ai",
    archived: false,
    ...patch,
  }) as Conversation;

const list = [
  make("1", { handoff: "needs-human", unread: 2 }),
  make("2", { handoff: "assigned", assignedAgent: { id: "3", name: "Sarah", avatar: "" } }),
  make("3", { handoff: "assigned", assignedAgent: { id: "9", name: "Other", avatar: "" }, unread: 1 }),
  make("4", { archived: true, name: "Maya Chen" }),
  undefined,
];
const ids = (opts: Partial<Parameters<typeof filterConversations>[1]>) =>
  filterConversations(list, { filter: "all", query: "", me: "3", ...opts }).map((c) => c.id);

describe("filterConversations", () => {
  it("shows everything except archived by default, and skips missing entries", () => {
    expect(ids({})).toEqual(["1", "2", "3"]);
  });

  it("Mine: only conversations assigned to the signed-in agent", () => {
    expect(ids({ filter: "mine" })).toEqual(["2"]);
    expect(ids({ filter: "mine", me: null })).toEqual([]);
  });

  it("Unread, Unassigned (waiting in the queue) and Archived", () => {
    expect(ids({ filter: "unread" })).toEqual(["1", "3"]);
    expect(ids({ filter: "unassigned" })).toEqual(["1"]);
    expect(ids({ filter: "archived" })).toEqual(["4"]);
  });

  it("combines a filter with search on name or preview, case-insensitively", () => {
    expect(ids({ query: "CUSTOMER 3" })).toEqual(["3"]);
    expect(ids({ query: "hello", filter: "unread" })).toEqual(["1", "3"]);
    expect(ids({ query: "maya", filter: "archived" })).toEqual(["4"]);
    expect(ids({ query: "maya" })).toEqual([]);
  });
});
