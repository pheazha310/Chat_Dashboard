import { describe, expect, it } from "vitest";
import { avatarFor } from "./avatar";

describe("avatarFor", () => {
  it("is deterministic and shows the initials", () => {
    expect(avatarFor("Maya Chen")).toBe(avatarFor("Maya Chen"));
    expect(decodeURIComponent(avatarFor("Maya Chen"))).toContain(">MC<");
    expect(decodeURIComponent(avatarFor("sokha"))).toContain(">S<");
  });

  it("copes with empty and markup-like names", () => {
    expect(decodeURIComponent(avatarFor(""))).toContain(">?<");
    expect(decodeURIComponent(avatarFor("<script>"))).not.toContain("<script>");
  });
});
