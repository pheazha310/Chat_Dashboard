import { describe, expect, it } from "vitest";
import { uid } from "../../../__tests__/support/ids.js";
import { conversationParams, draftBody, MAX_DRAFT_LENGTH, preferencesBody } from "../workspace.schema.js";

describe("workspace schemas", () => {
  it("rejects an empty preference update and non-boolean values", () => {
    expect(preferencesBody.safeParse({}).success).toBe(false);
    expect(preferencesBody.safeParse({ restoreTabs: "yes" }).success).toBe(false);
    expect(preferencesBody.safeParse({ persistTabs: false }).success).toBe(true);
  });

  it("limits the draft size and requires a valid conversation id", () => {
    expect(draftBody.safeParse({ content: "x".repeat(MAX_DRAFT_LENGTH) }).success).toBe(true);
    expect(draftBody.safeParse({ content: "x".repeat(MAX_DRAFT_LENGTH + 1) }).success).toBe(false);
    expect(conversationParams.safeParse({ conversationId: "nope" }).success).toBe(false);
    expect(conversationParams.safeParse({ conversationId: uid(1) }).success).toBe(true);
  });
});
