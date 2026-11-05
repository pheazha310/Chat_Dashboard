import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getConversation: vi.fn(),
  getActivities: vi.fn(),
  listConversations: vi.fn(),
  mock: { value: false },
}));
vi.mock("@/shared/api/rest", () => ({
  getConversation: api.getConversation,
  getActivities: api.getActivities,
  listConversations: api.listConversations,
}));
vi.mock("@/shared/api/ws", () => ({
  get isMockTransport() {
    return api.mock.value;
  },
}));
vi.mock("@/shared/ui", () => ({ notify: vi.fn() }));

import { notify } from "@/shared/ui";
import { loadArchived, loadDetails } from "./details";
import { useConversationStore, type Conversation } from "./store";

const backendConversation = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  customerId: "100",
  customerName: "Maya Chen",
  customerIdentifier: null,
  applicationId: null,
  subject: null,
  status: "OPEN",
  priority: "MEDIUM",
  conversationMode: "HUMAN",
  handoffStatus: "NEEDS_HUMAN",
  assignedAgentId: null,
  assignedAgent: null,
  isArchived: false,
  lastMessageAt: "2026-01-01T09:00:00.000Z",
  lastMessagePreview: "hi",
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.mock.value = false;
  useConversationStore.setState({
    byId: { a: { id: "a", unread: 3, summary: "", activity: [] } as unknown as Conversation },
    order: ["a"],
    selectedId: "a",
    query: "",
    filter: "all",
  });
});

describe("loadDetails", () => {
  it("fills in the summary and activity timeline without touching the unread count", async () => {
    api.getConversation.mockResolvedValue(backendConversation("a", { summary: "Wants a new date", unreadCount: 0 }));
    api.getActivities.mockResolvedValue([
      {
        id: "1",
        conversationId: "a",
        activityType: "ASSIGNED",
        description: "Assigned",
        createdAt: "2026-01-01T09:00:00.000Z",
      },
    ]);
    await loadDetails("a");
    const conversation = useConversationStore.getState().byId.a!;
    expect(conversation.summary).toBe("Wants a new date");
    expect(conversation.activity).toMatchObject([{ id: "1", title: "Assigned", copy: "Assigned" }]);
    expect(conversation.unread).toBe(3);
  });

  it("stays quiet when the details cannot be loaded, and does nothing with the mock transport", async () => {
    api.getConversation.mockRejectedValue(new Error("down"));
    api.getActivities.mockResolvedValue([]);
    await expect(loadDetails("a")).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
    api.mock.value = true;
    api.getConversation.mockClear();
    await loadDetails("a");
    expect(api.getConversation).not.toHaveBeenCalled();
  });
});

describe("loadArchived", () => {
  it("adds the archived conversations to the store, flagged archived", async () => {
    api.listConversations.mockResolvedValue([backendConversation("z", { isArchived: true, unreadCount: 1 })]);
    await loadArchived();
    expect(api.listConversations).toHaveBeenCalledWith({ filter: "archived", size: 100 });
    expect(useConversationStore.getState().byId.z).toMatchObject({ archived: true, unread: 1, name: "Maya Chen" });
  });

  it("tells the agent when it fails", async () => {
    api.listConversations.mockRejectedValue(new Error("down"));
    await loadArchived();
    expect(notify).toHaveBeenCalledWith("Could not load archived conversations");
  });
});
