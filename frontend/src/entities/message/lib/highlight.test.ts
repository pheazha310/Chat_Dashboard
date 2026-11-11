import { describe, expect, it } from "vitest";
import { splitMatches } from "./highlight";

describe("splitMatches", () => {
  it("marks every match in any case, keeping the original text", () => {
    expect(splitMatches("Salary? My salary is 1,200", "SALARY")).toEqual([
      { text: "Salary", match: true },
      { text: "? My ", match: false },
      { text: "salary", match: true },
      { text: " is 1,200", match: false },
    ]);
  });

  it("treats the query literally and returns the text whole when there is no query or no match", () => {
    expect(splitMatches("rate 100% (fixed)", "100% (")).toEqual([
      { text: "rate ", match: false },
      { text: "100% (", match: true },
      { text: "fixed)", match: false },
    ]);
    expect(splitMatches("hello", "  ")).toEqual([{ text: "hello", match: false }]);
    expect(splitMatches("hello", "bye")).toEqual([{ text: "hello", match: false }]);
  });
});
