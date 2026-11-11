import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ apiRequest: request }));

import {
  createTrainingExampleRequest,
  getAutoResponses,
  saveAutoResponsesRequest,
  setTrainingApprovalRequest,
} from "./automation";

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ data: "ok" });
});

describe("automation requests", () => {
  it("reads and saves the automatic replies", async () => {
    await getAutoResponses();
    expect(request).toHaveBeenLastCalledWith("/automation/auto-responses");
    await saveAutoResponsesRequest({ awayMessage: "a", firstResponse: "f" });
    expect(request).toHaveBeenLastCalledWith("/automation/auto-responses", {
      method: "PUT",
      body: { awayMessage: "a", firstResponse: "f" },
    });
  });

  it("proposes and approves a training example under the names the backend expects", async () => {
    await createTrainingExampleRequest("Q", "A");
    expect(request).toHaveBeenLastCalledWith("/automation/training-examples", {
      method: "POST",
      body: { customerMessage: "Q", suggestedReply: "A" },
    });
    await setTrainingApprovalRequest("e1", true);
    expect(request).toHaveBeenLastCalledWith("/automation/training-examples/e1", {
      method: "PATCH",
      body: { approved: true },
    });
  });
});
