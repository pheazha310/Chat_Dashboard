import { describe, expect, it } from "vitest";
import { uid } from "../../../__tests__/support/ids.js";
import {
  completeCallbackBody,
  createCallbackBody,
  listCallbacksQuery,
  updateCallbackBody,
} from "../callback.schema.js";

describe("callback schemas", () => {
  it("needs a time with a UTC offset, so it is never read in the server's time zone", () => {
    expect(createCallbackBody.safeParse({ scheduledAt: "2030-05-01T09:00:00Z" }).success).toBe(true);
    expect(createCallbackBody.safeParse({ scheduledAt: "2030-05-01T09:00:00+07:00" }).success).toBe(true);
    expect(createCallbackBody.safeParse({ scheduledAt: "2030-05-01T09:00:00" }).success).toBe(false);
    expect(createCallbackBody.safeParse({ scheduledAt: "tomorrow" }).success).toBe(false);
    expect(createCallbackBody.safeParse({}).success).toBe(false);
  });

  it("turns the time into a Date and trims or drops blank notes", () => {
    const parsed = createCallbackBody.parse({ scheduledAt: "2030-05-01T09:00:00Z", notes: "   " });
    expect(parsed.scheduledAt).toEqual(new Date("2030-05-01T09:00:00Z"));
    expect(parsed.notes).toBeNull();
    expect(createCallbackBody.parse({ scheduledAt: "2030-05-01T09:00:00Z", notes: " ask about rate " }).notes).toBe(
      "ask about rate",
    );
  });

  it("limits note length and validates the assignee id", () => {
    const at = "2030-05-01T09:00:00Z";
    expect(createCallbackBody.safeParse({ scheduledAt: at, notes: "x".repeat(2001) }).success).toBe(false);
    expect(createCallbackBody.safeParse({ scheduledAt: at, assignedAgentId: "nope" }).success).toBe(false);
    expect(createCallbackBody.safeParse({ scheduledAt: at, assignedAgentId: uid(3) }).success).toBe(true);
  });

  it("needs at least one field to update", () => {
    expect(updateCallbackBody.safeParse({}).success).toBe(false);
    expect(updateCallbackBody.safeParse({ notes: null }).success).toBe(false);
    expect(updateCallbackBody.safeParse({ notes: "later" }).success).toBe(true);
    expect(completeCallbackBody.safeParse({}).success).toBe(true);
  });

  it("defaults the list to my callbacks and rejects unknown statuses", () => {
    expect(listCallbacksQuery.parse({}).scope).toBe("mine");
    expect(listCallbacksQuery.safeParse({ status: "DONE" }).success).toBe(false);
    expect(listCallbacksQuery.safeParse({ scope: "everyone" }).success).toBe(false);
  });
});
