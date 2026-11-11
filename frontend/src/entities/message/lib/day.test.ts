import { describe, expect, it } from "vitest";
import { dayKey, dayLabel } from "./day";

const now = new Date(2026, 10, 11, 15, 0); // Nov 11 2026, local time

describe("dayLabel", () => {
  it("says Today and Yesterday like chat apps, then the date, with the year only when it differs", () => {
    expect(dayLabel(new Date(2026, 10, 11, 0, 5).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 10, 23, 59).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 3, 9).toISOString(), now)).toBe(
      new Date(2026, 9, 3).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
    );
    expect(dayLabel(new Date(2025, 9, 3, 9).toISOString(), now)).toBe(
      new Date(2025, 9, 3).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }),
    );
  });

  it("returns nothing for a time it cannot read", () => {
    expect(dayLabel("not a date", now)).toBe("");
  });
});

describe("dayKey", () => {
  it("is the same for two times on one local day and differs across midnight", () => {
    expect(dayKey(new Date(2026, 9, 3, 0, 1).toISOString())).toBe(dayKey(new Date(2026, 9, 3, 23, 59).toISOString()));
    expect(dayKey(new Date(2026, 9, 3, 23, 59).toISOString())).not.toBe(
      dayKey(new Date(2026, 9, 4, 0, 1).toISOString()),
    );
    expect(dayKey(new Date(2026, 9, 3).toISOString())).toBe("2026-10-03");
  });
});
