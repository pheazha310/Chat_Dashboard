import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("splits rows and columns", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quotes, commas, escaped quotes, newlines inside cells and CRLF", () => {
    expect(parseCsv('name,note\r\n"Doe, Jo","say ""hi""\nbye"\r\n')).toEqual([
      ["name", "note"],
      ["Doe, Jo", 'say "hi"\nbye'],
    ]);
  });

  it("keeps empty cells and ignores a trailing blank line", () => {
    expect(parseCsv("a,,c\n,,\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });
});
