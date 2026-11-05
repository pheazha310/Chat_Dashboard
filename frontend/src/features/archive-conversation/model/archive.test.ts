import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  archiveConversationRequest: vi.fn(),
  restoreConversationRequest: vi.fn(),
  mock: { value: false },
}));
vi.mock("@/shared/api/rest", async () => ({
  ApiError: (await vi.importActual<typeof import("@/shared/api/rest")>("@/shared/api/rest")).ApiError,
  archiveConversationRequest: api.archiveConversationRequest,
  restoreConversationRequest: api.restoreConversationRequest,
}));
vi.mock("@/shared/api/ws", () => ({
  get isMockTransport() {
    return api.mock.value;
  },
}));
vi.mock("@/shared/ui", () => ({ notify: vi.fn() }));

import { useConversationStore, type Conversation } from "@/entities/conversation";
import { ApiError } from "@/shared/api/rest";
import { notify } from "@/shared/ui";
import { archiveConversation, restoreConversation } from "./archive";

const state = () => useConversationStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  api.mock.value = false;
  useConversationStore.setState({
    byId: { a: { id: "a", archived: false } as Conversation, b: { id: "b", archived: false } as Conversation },
    order: ["a", "b"],
    selectedId: "a",
    query: "",
    filter: "all",
  });
});

describe("archiveConversation", () => {
  it("archives at once, moves the selection on, and asks the server", async () => {
    api.archiveConversationRequest.mockResolvedValue({});
    const pending = archiveConversation("a");
    expect(state().byId.a?.archived).toBe(true);
    expect(state().selectedId).toBe("b");
    expect(await pending).toBe(true);
    expect(api.archiveConversationRequest).toHaveBeenCalledWith("a");
  });

  it("undoes the change and explains when the server refuses", async () => {
    api.archiveConversationRequest.mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "You cannot archive this conversation"),
    );
    expect(await archiveConversation("a")).toBe(false);
    expect(state().byId.a?.archived).toBe(false);
    expect(notify).toHaveBeenCalledWith("Could not archive: You cannot archive this conversation");
  });

  it("stays local with the mock transport", async () => {
    api.mock.value = true;
    expect(await archiveConversation("a")).toBe(true);
    expect(api.archiveConversationRequest).not.toHaveBeenCalled();
    expect(state().byId.a?.archived).toBe(true);
  });
});

describe("restoreConversation", () => {
  it("restores, and goes back to archived if the server refuses", async () => {
    useConversationStore.setState({ byId: { a: { id: "a", archived: true } as Conversation } });
    api.restoreConversationRequest.mockRejectedValue(new ApiError(409, "CONFLICT", "Already active"));
    expect(await restoreConversation("a")).toBe(false);
    expect(state().byId.a?.archived).toBe(true);
    api.restoreConversationRequest.mockResolvedValue({});
    expect(await restoreConversation("a")).toBe(true);
    expect(state().byId.a?.archived).toBe(false);
  });
});
