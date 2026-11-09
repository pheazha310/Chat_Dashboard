import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  listCallbacks: vi.fn(),
  scheduleCallbackRequest: vi.fn(),
  completeCallbackRequest: vi.fn(),
  cancelCallbackRequest: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/ui", () => ({ notify }));

import type { Callback } from "@/shared/api/rest";
import { cancelCallback, completeCallback, loadCallbacks, scheduleCallback, useCallbackStore } from "./store";

const callback = (id: string, scheduledAt: string, patch: Partial<Callback> = {}): Callback => ({
  id,
  conversationId: "a",
  customerId: "c",
  assignedAgentId: "me",
  createdBy: "me",
  scheduledAt,
  status: "PENDING",
  notes: null,
  completionNote: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  completedAt: null,
  permissions: { canEdit: true, canComplete: true, canCancel: true },
  ...patch,
});
const ids = () => useCallbackStore.getState().byConversation.a?.map((item) => item.id);

beforeEach(() => {
  vi.resetAllMocks();
  useCallbackStore.setState({ byConversation: {}, status: {} });
});

describe("callback store", () => {
  it("loads a conversation's callbacks soonest first", async () => {
    rest.listCallbacks.mockResolvedValue([
      callback("late", "2030-02-01T10:00:00.000Z"),
      callback("soon", "2030-01-01T10:00:00.000Z"),
    ]);
    await loadCallbacks("a");
    expect(ids()).toEqual(["soon", "late"]);
    expect(useCallbackStore.getState().status.a).toBe("ready");
  });

  it("marks the load as failed instead of throwing", async () => {
    rest.listCallbacks.mockRejectedValue(new Error("500"));
    await loadCallbacks("a");
    expect(useCallbackStore.getState().status.a).toBe("error");
  });

  it("sends the local time as an ISO time with an offset, and adds the saved callback in order", async () => {
    useCallbackStore.setState({ byConversation: { a: [callback("later", "2031-01-01T10:00:00.000Z")] } });
    rest.scheduleCallbackRequest.mockResolvedValue(callback("new", "2030-06-01T10:00:00.000Z"));

    expect(await scheduleCallback("a", "2030-06-01T12:00", "  ask about the rate  ")).toBe(true);

    const [conversationId, sentAt, notes] = rest.scheduleCallbackRequest.mock.calls[0]!;
    expect(conversationId).toBe("a");
    expect(sentAt).toBe(new Date("2030-06-01T12:00").toISOString());
    expect(notes).toBe("ask about the rate");
    expect(ids()).toEqual(["new", "later"]);
  });

  it("does not call the server without a valid time", async () => {
    expect(await scheduleCallback("a", "", "")).toBe(false);
    expect(rest.scheduleCallbackRequest).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
  });

  it("says why when the server refuses to schedule", async () => {
    rest.scheduleCallbackRequest.mockRejectedValue(new Error("scheduledAt must be in the future"));
    expect(await scheduleCallback("a", "2030-06-01T12:00", "")).toBe(false);
    expect(notify).toHaveBeenCalledWith("scheduledAt must be in the future");
    expect(ids()).toBeUndefined();
  });

  it("replaces a callback with the server's version when it is completed or cancelled", async () => {
    const open = callback("x", "2030-01-01T10:00:00.000Z");
    useCallbackStore.setState({ byConversation: { a: [open] } });
    rest.completeCallbackRequest.mockResolvedValue({ ...open, status: "COMPLETED", completionNote: "reached" });
    expect(await completeCallback(open, " reached ")).toBe(true);
    expect(rest.completeCallbackRequest).toHaveBeenCalledWith("x", "reached");
    expect(useCallbackStore.getState().byConversation.a?.[0]?.status).toBe("COMPLETED");

    rest.cancelCallbackRequest.mockResolvedValue({ ...open, status: "CANCELLED" });
    expect(await cancelCallback(open)).toBe(true);
    expect(useCallbackStore.getState().byConversation.a?.[0]?.status).toBe("CANCELLED");
  });

  it("reloads the list when a change is refused because someone else already closed it", async () => {
    const open = callback("x", "2030-01-01T10:00:00.000Z");
    rest.completeCallbackRequest.mockRejectedValue(new Error("This callback is already closed"));
    rest.listCallbacks.mockResolvedValue([{ ...open, status: "CANCELLED" }]);

    expect(await completeCallback(open)).toBe(false);
    await vi.waitFor(() => expect(useCallbackStore.getState().byConversation.a?.[0]?.status).toBe("CANCELLED"));
    expect(notify).toHaveBeenCalledWith("This callback is already closed");
  });
});
