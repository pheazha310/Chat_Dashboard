import { describe, expect, it } from "vitest";
import { chatSettingsBody } from "../chat-settings.schema.js";

describe("chat settings schema", () => {
  it("needs at least one setting and rejects anything that is not a boolean", () => {
    expect(chatSettingsBody.safeParse({}).success).toBe(false);
    expect(chatSettingsBody.safeParse({ typingSoundEnabled: "yes" }).success).toBe(false);
    expect(chatSettingsBody.safeParse({ autoAssignEnabled: null }).success).toBe(false);
    expect(chatSettingsBody.safeParse({ autoAssignEnabled: true, aiSummariesEnabled: false }).success).toBe(true);
  });

  it("rejects unknown keys, so a mistyped switch is not silently ignored", () => {
    expect(chatSettingsBody.safeParse({ typingSoundEnabled: true, userId: "x" }).success).toBe(false);
    expect(chatSettingsBody.safeParse({ typingSound: true }).success).toBe(false);
  });
});
