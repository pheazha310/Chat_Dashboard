import { describe, expect, it } from "vitest";
import { parseRange } from "../attachment.range.js";

describe("parseRange", () => {
  it("sends the whole file without a usable Range header", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(parseRange("bytes=0-1,5-9", 100)).toBeNull(); // several ranges are not supported
    expect(parseRange("bytes=-", 100)).toBeNull();
  });

  it("parses start-end, open-ended and suffix ranges", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=50-5000", 100)).toEqual({ start: 50, end: 99 });
  });

  it("flags ranges outside the file", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=20-10", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
  });
});
