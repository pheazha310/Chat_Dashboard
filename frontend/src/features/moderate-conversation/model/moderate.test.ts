import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({ blockConversationCustomer: vi.fn(), reportSpamRequest: vi.fn() }));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/ui", () => ({ notify }));

import { blockConversationCustomerAction, reportSpamAction } from "./moderate";

beforeEach(() => vi.resetAllMocks());

describe("moderating a conversation", () => {
  it("blocks the customer with a trimmed reason, or none", async () => {
    rest.blockConversationCustomer.mockResolvedValue({});
    expect(await blockConversationCustomerAction("a", "  abusive ")).toBe(true);
    expect(rest.blockConversationCustomer).toHaveBeenCalledWith("a", "abusive");
    await blockConversationCustomerAction("a", "   ");
    expect(rest.blockConversationCustomer).toHaveBeenLastCalledWith("a", undefined);
    expect(notify).toHaveBeenCalledWith("Customer blocked");
  });

  it("shows the server's reason when it refuses", async () => {
    rest.blockConversationCustomer.mockRejectedValue(new Error("Only the agent who owns the conversation can block"));
    expect(await blockConversationCustomerAction("a")).toBe(false);
    expect(notify).toHaveBeenCalledWith("Only the agent who owns the conversation can block");
  });

  it("reports with a reason (and optionally a message) but never an empty one", async () => {
    rest.reportSpamRequest.mockResolvedValue({});
    expect(await reportSpamAction("a", "   ")).toBe(false);
    expect(rest.reportSpamRequest).not.toHaveBeenCalled();
    expect(await reportSpamAction("a", " phishing ", "m1")).toBe(true);
    expect(rest.reportSpamRequest).toHaveBeenCalledWith("a", "phishing", "m1");
    rest.reportSpamRequest.mockRejectedValue(new Error("You already have a pending report about this"));
    expect(await reportSpamAction("a", "again")).toBe(false);
    expect(notify).toHaveBeenCalledWith("You already have a pending report about this");
  });
});
