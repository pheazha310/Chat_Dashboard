import { describe, expect, it } from "vitest";
import { uid } from "../../../__tests__/support/ids.js";
import { editBody, forwardBody, reactionBody, replyBody } from "../message-action.schema.js";

describe("message action schemas", () => {
  it("accepts emoji, including sequences, and rejects plain text", () => {
    for (const emoji of ["👍", "❤️", "👍🏽", "👨‍👩‍👧", "🇰🇭", "1️⃣"]) {
      expect(reactionBody.safeParse({ emoji }).success, emoji).toBe(true);
    }
    for (const emoji of ["", "a", "1", "👍a", "<script>"]) {
      expect(reactionBody.safeParse({ emoji }).success, emoji).toBe(false);
    }
  });

  it("requires non-blank text and ids", () => {
    expect(editBody.safeParse({ text: "   " }).success).toBe(false);
    expect(replyBody.safeParse({ clientId: "c", text: "hi" }).success).toBe(true);
    expect(forwardBody.safeParse({ clientId: "c", targetConversationId: "x" }).success).toBe(false);
    expect(forwardBody.safeParse({ clientId: "c", targetConversationId: uid(1) }).success).toBe(true);
  });
});
