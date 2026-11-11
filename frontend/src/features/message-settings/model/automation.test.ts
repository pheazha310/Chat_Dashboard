import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  createTrainingExampleRequest: vi.fn(),
  getAutoResponses: vi.fn(),
  listTrainingExamples: vi.fn(),
  saveAutoResponsesRequest: vi.fn(),
  setTrainingApprovalRequest: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/ui", () => ({ notify }));

import {
  addTrainingExample,
  loadAutomation,
  saveAutoResponses,
  setTrainingApproval,
  useAutomationStore as store,
} from "./automation";

const example = (id: string, status: "PENDING" | "APPROVED" = "PENDING") => ({
  id,
  customerMessage: `Q ${id}`,
  suggestedReply: `A ${id}`,
  status,
  createdBy: "u1",
  approvedBy: status === "APPROVED" ? "u9" : null,
  approvedAt: status === "APPROVED" ? "2030-01-01T00:00:00.000Z" : null,
  createdAt: "2030-01-01T00:00:00.000Z",
});

beforeEach(() => {
  vi.resetAllMocks();
  store.setState({ autoResponses: null, examples: [], status: "idle" });
});

describe("automation store", () => {
  it("loads the replies and examples together, and reports a failed load", async () => {
    rest.getAutoResponses.mockResolvedValue({ awayMessage: "away", firstResponse: null });
    rest.listTrainingExamples.mockResolvedValue([example("1")]);
    await loadAutomation();
    expect(store.getState()).toMatchObject({ status: "ready", autoResponses: { awayMessage: "away" } });
    expect(store.getState().examples).toHaveLength(1);

    rest.getAutoResponses.mockRejectedValue(new Error("down"));
    await loadAutomation();
    expect(store.getState().status).toBe("error");
  });

  it("takes the saved replies from the server's answer", async () => {
    rest.saveAutoResponsesRequest.mockResolvedValue({ awayMessage: "a", firstResponse: "f" });
    expect(await saveAutoResponses({ awayMessage: "a", firstResponse: "f" })).toBe(true);
    expect(store.getState().autoResponses).toEqual({ awayMessage: "a", firstResponse: "f" });
  });

  it("says why a save was refused and keeps what it had", async () => {
    store.setState({ autoResponses: { awayMessage: "old", firstResponse: "old" } });
    rest.saveAutoResponsesRequest.mockRejectedValue(new Error("Only supervisors can change the automatic replies"));
    expect(await saveAutoResponses({ awayMessage: "a", firstResponse: "f" })).toBe(false);
    expect(notify).toHaveBeenCalledWith("Only supervisors can change the automatic replies");
    expect(store.getState().autoResponses).toEqual({ awayMessage: "old", firstResponse: "old" });
  });

  it("puts a new example first, and does nothing when the server refuses", async () => {
    store.setState({ examples: [example("1")] });
    rest.createTrainingExampleRequest.mockResolvedValue(example("2"));
    expect(await addTrainingExample("Q 2", "A 2")).toBe(true);
    expect(store.getState().examples.map((item) => item.id)).toEqual(["2", "1"]);

    rest.createTrainingExampleRequest.mockRejectedValue(new Error("nope"));
    expect(await addTrainingExample("x", "y")).toBe(false);
    expect(store.getState().examples).toHaveLength(2);
  });

  it("replaces an example with the server's version after approval, and reloads when refused", async () => {
    store.setState({ examples: [example("1")] });
    rest.setTrainingApprovalRequest.mockResolvedValue(example("1", "APPROVED"));
    await setTrainingApproval("1", true);
    expect(store.getState().examples[0]?.status).toBe("APPROVED");

    rest.setTrainingApprovalRequest.mockRejectedValue(new Error("Only supervisors can approve training examples"));
    rest.getAutoResponses.mockResolvedValue({ awayMessage: null, firstResponse: null });
    rest.listTrainingExamples.mockResolvedValue([example("1")]);
    await setTrainingApproval("1", false);
    expect(notify).toHaveBeenCalledWith("Only supervisors can approve training examples");
    expect(rest.listTrainingExamples).toHaveBeenCalled();
  });
});
