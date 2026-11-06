import { describe, expect, it } from "vitest";
import { createBody, listQuery, updateBody } from "../canned-response.schema.js";

describe("canned response schemas", () => {
  it("accepts slash shortcuts and refuses others", () => {
    for (const shortcut of ["/hi", "/follow-up_2", "/A"])
      expect(createBody.safeParse({ title: "t", content: "c", shortcut }).success, shortcut).toBe(true);
    for (const shortcut of ["hi", "/", "/has space", "//x", `/${"x".repeat(50)}`]) {
      expect(createBody.safeParse({ title: "t", content: "c", shortcut }).success, shortcut).toBe(false);
    }
  });

  it("defaults to personal, refuses team scope and blank text", () => {
    expect(createBody.parse({ title: " t ", content: " c " })).toMatchObject({
      title: "t",
      content: "c",
      scope: "PERSONAL",
    });
    expect(createBody.safeParse({ title: "t", content: "c", scope: "TEAM" }).success).toBe(false);
    expect(createBody.safeParse({ title: "  ", content: "c" }).success).toBe(false);
    expect(createBody.safeParse({ title: "t", content: "x".repeat(4001) }).success).toBe(false);
  });

  it("needs a change to update, and allows clearing the shortcut", () => {
    expect(updateBody.safeParse({}).success).toBe(false);
    expect(updateBody.parse({ shortcut: null })).toEqual({ shortcut: null });
    expect(updateBody.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it("parses list filters", () => {
    expect(listQuery.parse({ includeInactive: "true", scope: "SHARED", q: " hi " })).toMatchObject({
      includeInactive: true,
      scope: "SHARED",
      q: "hi",
    });
    expect(listQuery.parse({}).includeInactive).toBe(false);
    expect(listQuery.safeParse({ scope: "TEAM" }).success).toBe(false);
  });
});
