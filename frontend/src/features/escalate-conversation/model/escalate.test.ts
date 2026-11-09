import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({ escalateRequest: vi.fn() }));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/ui", () => ({ notify }));

import { escalateConversation } from "./escalate";

beforeEach(() => vi.clearAllMocks());

describe("escalateConversation", () => {
  it("sends a trimmed reason, or none, and confirms", async () => {
    rest.escalateRequest.mockResolvedValue({});
    await expect(escalateConversation("a", "  upset  ")).resolves.toBe(true);
    expect(rest.escalateRequest).toHaveBeenLastCalledWith("a", "upset");
    await escalateConversation("a", "   ");
    expect(rest.escalateRequest).toHaveBeenLastCalledWith("a", undefined);
    expect(notify).toHaveBeenCalledWith("Conversation escalated to a supervisor");
  });

  it("tells the agent when the server refuses, for example a pending escalation", async () => {
    rest.escalateRequest.mockRejectedValue(new Error("This conversation already has a pending escalation"));
    await expect(escalateConversation("a")).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith("This conversation already has a pending escalation");
  });
});
