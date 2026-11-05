import { describe, expect, it } from "vitest";
import { idSchema } from "../ids.js";
import { cursorQuery, pageArgs, pageMeta, pageQuery } from "../pagination.js";
import { uid } from "../../../__tests__/support/ids.js";

describe("pagination", () => {
  it("applies defaults and computes skip/take", () => {
    const q = pageQuery.parse({});
    expect(q).toEqual({ page: 1, size: 25 });
    expect(pageArgs({ page: 3, size: 10 })).toEqual({ skip: 20, take: 10 });
  });

  it("caps size and computes meta", () => {
    expect(() => pageQuery.parse({ size: "500" })).toThrow();
    expect(pageMeta(0, { page: 1, size: 25 }).totalPages).toBe(1);
    expect(pageMeta(51, { page: 1, size: 25 }).totalPages).toBe(3);
  });

  it("rejects before+after together", () => {
    expect(() => cursorQuery.parse({ before: "5", after: "2" })).toThrow();
    expect(cursorQuery.parse({ before: "5" }).before).toBe(5n);
  });
});

describe("idSchema", () => {
  it("accepts a UUID (lower-cased) and rejects junk", () => {
    expect(idSchema.parse(uid(123))).toBe(uid(123));
    expect(idSchema.parse(uid(123).toUpperCase())).toBe(uid(123));
    for (const bad of ["0", "123", "-1", "abc", "1".repeat(36), `${uid(1)}x`])
      expect(() => idSchema.parse(bad)).toThrow();
  });
});
