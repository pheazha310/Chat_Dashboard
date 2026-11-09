import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration } from "./format-size";

describe("formatBytes", () => {
  it("picks a readable unit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(842 * 1024)).toBe("842 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });
});

describe("formatDuration", () => {
  it("formats minutes and seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(4210)).toBe("0:04");
    expect(formatDuration(83_000)).toBe("1:23");
    expect(formatDuration(-5)).toBe("0:00");
  });
});
