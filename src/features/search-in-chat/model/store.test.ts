import { describe, expect, it } from "vitest";
import { filterByQuery, matchesQuery } from "./store";

describe("matchesQuery", () => {
  it("matches case-insensitively and ignores accents", () => {
    expect(matchesQuery("Café au lait", "cafe")).toBe(true);
    expect(matchesQuery("Café au lait", "CAFÉ")).toBe(true);
  });

  it("returns all messages when the query is empty", () => {
    expect(matchesQuery("Hello from the team", "   ")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesQuery("Customer asks about billing", "refund")).toBe(false);
  });
});

describe("filterByQuery", () => {
  const items = [{ text: "Café au lait" }, { text: "Billing question" }];
  const getText = (item: { text: string }) => item.text;

  it("filters accent-insensitively", () => {
    expect(filterByQuery(items, " CAFE ", getText)).toEqual([items[0]]);
  });

  it("returns the same array for a blank query", () => {
    expect(filterByQuery(items, "  ", getText)).toBe(items);
  });
});
