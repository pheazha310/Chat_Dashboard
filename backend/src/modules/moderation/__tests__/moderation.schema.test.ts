import { describe, expect, it } from "vitest";
import { uid } from "../../../__tests__/support/ids.js";
import {
  blockBody,
  createKeywordBody,
  listBlocksQuery,
  reportSpamBody,
  reviewReportBody,
  updateKeywordBody,
} from "../moderation.schema.js";

describe("moderation schemas", () => {
  it("trims keywords, limits their length and refuses control characters", () => {
    expect(createKeywordBody.parse({ keyword: "  free money " }).keyword).toBe("free money");
    expect(createKeywordBody.safeParse({ keyword: "   " }).success).toBe(false);
    expect(createKeywordBody.safeParse({ keyword: "x".repeat(256) }).success).toBe(false);
    expect(createKeywordBody.safeParse({ keyword: "a\u0000b" }).success).toBe(false);
    expect(updateKeywordBody.safeParse({}).success).toBe(false);
    expect(updateKeywordBody.safeParse({ isActive: false }).success).toBe(true);
  });

  it("needs a reason for a report, and a valid message id when given", () => {
    expect(reportSpamBody.safeParse({ reason: "  " }).success).toBe(false);
    expect(reportSpamBody.safeParse({ reason: "x".repeat(2001) }).success).toBe(false);
    expect(reportSpamBody.safeParse({ reason: "spam", messageId: "nope" }).success).toBe(false);
    expect(reportSpamBody.safeParse({ reason: "spam", messageId: uid(5) }).success).toBe(true);
  });

  it("accepts only confirm or dismiss when reviewing, and drops a blank note", () => {
    expect(reviewReportBody.safeParse({ status: "PENDING" }).success).toBe(false);
    expect(reviewReportBody.parse({ status: "CONFIRMED", resolutionNote: "  " }).resolutionNote).toBeUndefined();
    expect(reviewReportBody.safeParse({ status: "CONFIRMED", resolutionNote: "x".repeat(501) }).success).toBe(false);
  });

  it("treats a block reason as optional and lists current blocks by default", () => {
    expect(blockBody.parse({}).reason).toBeUndefined();
    expect(blockBody.safeParse({ reason: "x".repeat(1001) }).success).toBe(false);
    expect(listBlocksQuery.parse({}).active).toBe(true);
    expect(listBlocksQuery.parse({ active: "false" }).active).toBe(false);
    expect(listBlocksQuery.safeParse({ active: "maybe" }).success).toBe(false);
  });
});
