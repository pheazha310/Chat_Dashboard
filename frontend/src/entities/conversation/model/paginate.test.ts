import { describe, expect, it } from "vitest";
import { paginate } from "./paginate";

const items = Array.from({ length: 23 }, (_, i) => i);

describe("paginate", () => {
  it("slices one page and reports the page count", () => {
    expect(paginate(items, 1, 10)).toEqual({ items: items.slice(0, 10), page: 1, totalPages: 3 });
    expect(paginate(items, 3, 10).items).toEqual([20, 21, 22]);
  });

  it("clamps an out-of-range page and always has at least one page", () => {
    expect(paginate(items, 9, 10).page).toBe(3);
    expect(paginate(items, 0, 10).page).toBe(1);
    expect(paginate([], 1, 10)).toEqual({ items: [], page: 1, totalPages: 1 });
  });
});
