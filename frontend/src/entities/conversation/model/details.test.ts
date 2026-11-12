import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getConversation: vi.fn(),
  getActivities: vi.fn(),
  getApplication: vi.fn(),
  listConversations: vi.fn(),
  listConversationsPage: vi.fn(),
  mock: { value: false },
}));
vi.mock("@/shared/api/rest", () => ({
  getConversation: api.getConversation,
  getActivities: api.getActivities,
  getApplication: api.getApplication,
  listConversations: api.listConversations,
  listConversationsPage: api.listConversationsPage,
}));
vi.mock("@/shared/api/ws", () => ({
  get isMockTransport() {
    return api.mock.value;
  },
}));
vi.mock("@/shared/ui", () => ({ notify: vi.fn() }));

import { notify } from "@/shared/ui";
import { ensureConversation, loadArchived, loadDetails, loadMoreConversations } from "./details";
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

describe("loadDetails: the loan application", () => {
  const loaded = { id: "a", unread: 3, summary: "", activity: [], application: { appId: "731", status: "Unknown" } };
  beforeEach(() => {
    useConversationStore.setState({ byId: { a: loaded as unknown as Conversation } });
    api.getConversation.mockResolvedValue(backendConversation("a", { applicationId: 731 }));
    api.getActivities.mockResolvedValue([]);
  });

  it("shows the application LOS has for the customer in the panel", async () => {
    api.getApplication.mockResolvedValue({
      applicationId: 731,
      status: "REQUEST_REVIEWING",
      ticketNumber: "LN-000123",
      appliedDate: "2026-11-10T14:05:00.000Z",
      loanPurpose: "Business",
      requestedLoanSize: 500,
      requestedLoanTerm: 30,
      fetchedAt: "2026-11-12T01:00:00.000Z",
    });
    await loadDetails("a");
    expect(useConversationStore.getState().byId.a?.application).toMatchObject({
      appId: "731",
      product: "Business",
      amount: "$500",
      tenor: "30 days",
      status: "Reviewing",
      reference: "LN-000123",
    });
  });

  it("keeps what the panel already shows when there is no application yet (null)", async () => {
    api.getApplication.mockResolvedValue(null);
    await loadDetails("a");
    expect(useConversationStore.getState().byId.a?.application).toEqual(loaded.application);
  });

  it("still loads the summary and timeline when the application cannot be read", async () => {
    api.getConversation.mockResolvedValue(backendConversation("a", { summary: "Wants a new date" }));
    api.getApplication.mockRejectedValue(new Error("500"));
    await loadDetails("a");
    expect(useConversationStore.getState().byId.a?.summary).toBe("Wants a new date");
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

describe("ensureConversation", () => {
  it("fetches a conversation the inbox has not loaded (opened from a search hit)", async () => {
    api.getConversation.mockResolvedValue(backendConversation("z", { unreadCount: 2 }));
    await expect(ensureConversation("z")).resolves.toBe(true);
    expect(api.getConversation).toHaveBeenCalledWith("z");
    expect(useConversationStore.getState().byId.z).toMatchObject({ id: "z", name: "Maya Chen", unread: 2 });
  });

  it("does not fetch one it already holds, and reports one it cannot load", async () => {
    await expect(ensureConversation("a")).resolves.toBe(true);
    expect(api.getConversation).not.toHaveBeenCalled();
    api.getConversation.mockRejectedValue(new Error("gone"));
    await expect(ensureConversation("y")).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith("Could not open that conversation");
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

describe("loadMoreConversations", () => {
  beforeEach(() => useConversationStore.setState({ inboxPage: 1, inboxHasMore: true, inboxLoading: false }));

  it("appends the next page below the loaded ones and tracks whether more remain", async () => {
    api.listConversationsPage.mockResolvedValue({
      data: [backendConversation("old", { unreadCount: 2 })],
      meta: { page: 2, totalPages: 3 },
    });
    await loadMoreConversations();
    expect(api.listConversationsPage).toHaveBeenCalledWith({ filter: "all", page: 2, size: 100 });
    const state = useConversationStore.getState();
    expect(state.order).toEqual(["a", "old"]);
    expect(state.byId.old).toMatchObject({ unread: 2 });
    expect(state.inboxPage).toBe(2);
    expect(state.inboxHasMore).toBe(true);
  });

  it("stops offering more on the last page, and does nothing without more pages", async () => {
    api.listConversationsPage.mockResolvedValue({ data: [], meta: { page: 2, totalPages: 2 } });
    await loadMoreConversations();
    expect(useConversationStore.getState().inboxHasMore).toBe(false);
    api.listConversationsPage.mockClear();
    await loadMoreConversations();
    expect(api.listConversationsPage).not.toHaveBeenCalled();
  });

  it("tells the agent when it fails and allows a retry", async () => {
    api.listConversationsPage.mockRejectedValue(new Error("down"));
    await loadMoreConversations();
    expect(notify).toHaveBeenCalledWith("Could not load more conversations");
    expect(useConversationStore.getState()).toMatchObject({ inboxHasMore: true, inboxLoading: false });
  });
});
