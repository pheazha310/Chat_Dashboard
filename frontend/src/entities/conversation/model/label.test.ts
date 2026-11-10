import { describe, expect, it } from "vitest";
import { applicationLabel } from "./label";

describe("applicationLabel", () => {
  it("names the loan application so same-name rows can be told apart", () => {
    expect(applicationLabel({ appId: "547" })).toBe("App #547");
  });

  it("shows nothing when the application is unknown", () => {
    expect(applicationLabel({ appId: "—" })).toBeNull();
    expect(applicationLabel({ appId: "" })).toBeNull();
  });
});
