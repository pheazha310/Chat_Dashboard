import { describe, expect, it } from "vitest";
import { escapeLike } from "../like.js";

describe("escapeLike", () => {
  it("makes wildcard characters literal", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(escapeLike("plain text")).toBe("plain text");
    expect(escapeLike("")).toBe("");
  });
});
