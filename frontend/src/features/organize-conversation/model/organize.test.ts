import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  listTags: vi.fn(),
  createTagRequest: vi.fn(),
  setConversationTagsRequest: vi.fn(),
  setPriorityRequest: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/rest", () => rest);
vi.mock("@/shared/ui", () => ({ notify }));

import { useConversationStore, type Conversation } from "@/entities/conversation";
import { createTag, loadTagCatalog, setConversationTags, setPriority, useTagCatalog } from "./organize";

const conversation: Conversation = {
  id: "a",
  name: "A",
  avatar: "",
  preview: "",
  lastMessageAt: "t",
  unread: 0,
  urgent: false,
  priority: "MEDIUM",
  handoff: "assigned",
  application: { appId: "1", product: "p", amount: "$1", tenor: "1m", status: "New", reference: "r" },
  activity: [],
  summary: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  useTagCatalog.setState({ tags: [], status: "idle" });
  useConversationStore.setState({ byId: { a: conversation }, order: ["a"] });
});

describe("tag catalog", () => {
  it("loads every tag", async () => {
    rest.listTags.mockResolvedValue([
      { id: "t1", name: "VIP", color: "#fff", createdBy: "u", usageCount: 2, createdAt: "t" },
    ]);
    await loadTagCatalog();
    expect(useTagCatalog.getState()).toMatchObject({
      status: "ready",
      tags: [{ id: "t1", name: "VIP", color: "#fff" }],
    });
  });

  it("flags a failed load", async () => {
    rest.listTags.mockRejectedValue(new Error("offline"));
    await loadTagCatalog();
    expect(useTagCatalog.getState().status).toBe("error");
  });

  it("adds a created tag in name order, and explains a refusal", async () => {
    useTagCatalog.setState({ tags: [{ id: "t1", name: "Zeta", color: null }], status: "ready" });
    rest.createTagRequest.mockResolvedValueOnce({ id: "t2", name: "Alpha", color: null });
    await expect(createTag(" Alpha ")).resolves.toEqual({ id: "t2", name: "Alpha", color: null });
    expect(rest.createTagRequest).toHaveBeenCalledWith("Alpha");
    expect(useTagCatalog.getState().tags.map((t) => t.name)).toEqual(["Alpha", "Zeta"]);
    rest.createTagRequest.mockRejectedValueOnce(new Error('A tag named "Alpha" already exists'));
    await expect(createTag("alpha")).resolves.toBeNull();
    expect(notify).toHaveBeenCalledWith('A tag named "Alpha" already exists');
  });
});

describe("changing a conversation", () => {
  it("updates tags and priority from the server's answer", async () => {
    rest.setConversationTagsRequest.mockResolvedValue({ tags: [{ id: "t1", name: "VIP", color: null }] });
    await expect(setConversationTags("a", ["t1"])).resolves.toBe(true);
    expect(useConversationStore.getState().byId.a?.tags).toEqual([{ id: "t1", name: "VIP", color: null }]);

    rest.setPriorityRequest.mockResolvedValue({});
    await expect(setPriority("a", "HIGH")).resolves.toBe(true);
    expect(useConversationStore.getState().byId.a).toMatchObject({ priority: "HIGH", urgent: true });
  });

  it("leaves the conversation alone and says why when the server refuses", async () => {
    rest.setPriorityRequest.mockRejectedValue(
      new Error("Only the owner or a supervisor can change this conversation's priority"),
    );
    await expect(setPriority("a", "LOW")).resolves.toBe(false);
    expect(useConversationStore.getState().byId.a?.priority).toBe("MEDIUM");
    expect(notify).toHaveBeenCalledWith("Only the owner or a supervisor can change this conversation's priority");
    rest.setConversationTagsRequest.mockRejectedValue(new Error("nope"));
    await expect(setConversationTags("a", ["x"])).resolves.toBe(false);
    expect(useConversationStore.getState().byId.a?.tags).toBeUndefined();
  });
});
