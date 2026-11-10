import { describe, expect, it } from "vitest";
import { canReply } from "./reply";

const agent = (id: string) => ({ id, name: id, avatar: "" });

describe("canReply", () => {
  it("lets only the agent who handles the conversation write", () => {
    expect(canReply({ handoff: "assigned", assignedAgent: agent("me") }, "me")).toBe(true);
    expect(canReply({ handoff: "assigned", assignedAgent: agent("other") }, "me")).toBe(false);
  });

  it("asks for a takeover while nobody handles it, and when the agent is unknown", () => {
    expect(canReply({ handoff: "needs-human", assignedAgent: undefined }, "me")).toBe(false);
    expect(canReply({ handoff: "ai", assignedAgent: undefined }, "me")).toBe(false);
    expect(canReply({ handoff: "assigned", assignedAgent: agent("me") }, null)).toBe(false);
  });
});
