import { describe, expect, it } from "vitest";
import { accessContext, accessContextLabel } from "./embed";

/** Seam E: which way the dashboard was opened, so the UI can say so. */
describe("accessContext", () => {
  it("is embedded only inside a frame of LOS Web, whose origin is configured", () => {
    expect(accessContext({ framed: true, losWebOrigin: "https://los.example" })).toBe("embedded");
  });

  it("is standalone in its own tab, whatever LOS_WEB_ORIGIN says", () => {
    expect(accessContext({ framed: false, losWebOrigin: "https://los.example" })).toBe("standalone");
    expect(accessContext({ framed: false, losWebOrigin: undefined })).toBe("standalone");
  });

  it("is standalone in a frame when no LOS Web origin is configured, because no hand-off can be accepted", () => {
    expect(accessContext({ framed: true, losWebOrigin: undefined })).toBe("standalone");
  });

  it("has a label for each", () => {
    expect(accessContextLabel("embedded")).toBe("LOS-integrated access");
    expect(accessContextLabel("standalone")).toBe("Standalone access");
  });
});
