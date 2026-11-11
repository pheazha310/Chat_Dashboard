import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({ listPinsRequest: vi.fn(), pinRequest: vi.fn(), unpinRequest: vi.fn() }));
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/ui", () => ({ notify: vi.fn() }));

import type { ChatMessage } from "@/entities/message";
import { notify } from "@/shared/ui";
import { loadPins, togglePin, usePinStore } from "./pins";

const backendPin = (messageId: string, content: string, sequence = "5") => ({
  id: `p-${messageId}`,
  conversationId: "a",
  messageId,
  pinnedBy: "me",
  pinnedAt: "2026-10-03T09:00:00.000Z",
  message: { id: messageId, conversationId: "a", sequenceNumber: sequence, content },
});
const message = (id: string, text: string): ChatMessage => ({
  id,
  conversationId: "a",
  side: "customer",
  text,
  createdAt: "2026-10-03T09:00:00Z",
  sequence: "7",
  status: "sent",
});
const pins = () => usePinStore.getState().byConversation.a;

beforeEach(() => {
  vi.clearAllMocks();
  usePinStore.setState({ byConversation: {} });
});

describe("loadPins", () => {
  it("loads the pin bar of a conversation, newest pin first as the server sends it", async () => {
    rest.listPinsRequest.mockResolvedValue([backendPin("m2", "Callback Oct 3", "9"), backendPin("m1", "Salary 1,200")]);
    await loadPins("a");
    expect(rest.listPinsRequest).toHaveBeenCalledWith("a");
    expect(pins()).toEqual([
      { messageId: "m2", sequence: "9", text: "Callback Oct 3" },
      { messageId: "m1", sequence: "5", text: "Salary 1,200" },
    ]);
  });

  it("keeps the bar empty, without an error, when pins cannot be loaded", async () => {
    rest.listPinsRequest.mockRejectedValue(new Error("down"));
    await loadPins("a");
    expect(pins()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("togglePin", () => {
  it("pins a message to the top of the bar, and unpins it again", async () => {
    usePinStore.setState({ byConversation: { a: [{ messageId: "m1", sequence: "5", text: "Salary 1,200" }] } });
    rest.pinRequest.mockResolvedValue(backendPin("m7", "Agreed new date", "7"));
    await togglePin(message("m7", "Agreed new date"));
    expect(rest.pinRequest).toHaveBeenCalledWith("m7");
    expect(pins()?.map((p) => p.messageId)).toEqual(["m7", "m1"]);

    rest.unpinRequest.mockResolvedValue({ data: null });
    await togglePin(message("m7", "Agreed new date"));
    expect(rest.unpinRequest).toHaveBeenCalledWith("m7");
    expect(pins()?.map((p) => p.messageId)).toEqual(["m1"]);
  });

  it("shows the server's reason when it refuses (not allowed, or 10 pins already)", async () => {
    rest.pinRequest.mockRejectedValue(new Error("A conversation can have at most 10 pinned messages; unpin one first"));
    await togglePin(message("m7", "x"));
    expect(notify).toHaveBeenCalledWith("A conversation can have at most 10 pinned messages; unpin one first");
    expect(pins() ?? []).toEqual([]);
  });
});
