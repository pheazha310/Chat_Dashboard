import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, NotFoundError } from "@shared/errors/AppError.js";
import type { ConversationSummaryDto } from "@modules/conversations/index.js";
import type { WorkspaceRepository } from "../workspace.repository.js";
import { WorkspaceService } from "../workspace.service.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const repo = {
  findPreferences: vi.fn(),
  mergePreferences: vi.fn(),
  listTabs: vi.fn(),
  countTabs: vi.fn(),
  hasTab: vi.fn(),
  upsertTab: vi.fn(),
  deleteTab: vi.fn(),
  listDrafts: vi.fn(),
  upsertDraft: vi.fn(),
  deleteDraft: vi.fn(),
};
const conversations = { requireVisible: vi.fn(), visibleSummaries: vi.fn() };
const realtime = fakeRealtime();
const service = new WorkspaceService(fromPartial<WorkspaceRepository>(repo), realtime, () => conversations);

const agent: AuthContext = { userId: uid(1), role: "AGENT" };
const at = new Date("2026-01-01T00:00:00Z");
const summary = (id: string, unreadCount = 0) => fromPartial<ConversationSummaryDto>({ id, unreadCount });

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.findPreferences.mockResolvedValue({});
  repo.listTabs.mockResolvedValue([]);
  repo.listDrafts.mockResolvedValue([]);
  conversations.requireVisible.mockResolvedValue({});
  conversations.visibleSummaries.mockResolvedValue(new Map());
});

describe("get", () => {
  it("restores tabs with unread counts and drops conversations the agent can no longer see", async () => {
    repo.listTabs.mockResolvedValue([
      { conversationId: uid(10), sortOrder: 0, lastOpenedAt: at },
      { conversationId: uid(11), sortOrder: 1, lastOpenedAt: at },
    ]);
    repo.listDrafts.mockResolvedValue([
      { conversationId: uid(10), content: "Dear Maya", updatedAt: at },
      { conversationId: uid(11), content: "hidden", updatedAt: at },
    ]);
    conversations.visibleSummaries.mockResolvedValue(new Map([[uid(10), summary(uid(10), 4)]]));

    const result = await service.get(agent);

    expect(result.preferences).toEqual({ restoreTabs: true, persistTabs: true });
    expect(result.tabs.map((t) => [t.conversationId, t.conversation.unreadCount])).toEqual([[uid(10), 4]]);
    expect(result.drafts).toEqual([{ conversationId: uid(10), content: "Dear Maya", updatedAt: at.toISOString() }]);
    expect(conversations.visibleSummaries).toHaveBeenCalledWith(agent, [uid(10), uid(11), uid(10), uid(11)]);
  });

  it("returns no tabs when restoring is turned off, but still returns drafts", async () => {
    repo.findPreferences.mockResolvedValue({ restoreTabs: false });
    repo.listDrafts.mockResolvedValue([{ conversationId: uid(10), content: "x", updatedAt: at }]);
    conversations.visibleSummaries.mockResolvedValue(new Map([[uid(10), summary(uid(10))]]));
    const result = await service.get(agent);
    expect(repo.listTabs).not.toHaveBeenCalled();
    expect(result.tabs).toEqual([]);
    expect(result.drafts).toHaveLength(1);
  });

  it("ignores malformed stored preferences", async () => {
    repo.findPreferences.mockResolvedValue({ restoreTabs: "no", persistTabs: 0 });
    expect((await service.get(agent)).preferences).toEqual({ restoreTabs: true, persistTabs: true });
  });
});

describe("updatePreferences", () => {
  it("merges only the given keys and tells the agent's other windows", async () => {
    repo.mergePreferences.mockResolvedValue({ restoreTabs: false, persistTabs: true });
    const result = await service.updatePreferences(agent, { restoreTabs: false });
    expect(repo.mergePreferences).toHaveBeenCalledWith(uid(1), { restoreTabs: false });
    expect(result).toEqual({ restoreTabs: false, persistTabs: true });
    expect(realtime.agentEvent).toHaveBeenCalledWith(uid(1), "workspace.preferences_updated", {
      preferences: result,
    });
  });
});

describe("openTab", () => {
  it("opens a tab and announces it to the agent's windows", async () => {
    repo.hasTab.mockResolvedValue(false);
    repo.countTabs.mockResolvedValue(2);
    repo.upsertTab.mockResolvedValue({ sortOrder: 2, lastOpenedAt: at });
    await expect(service.openTab(agent, uid(10))).resolves.toEqual({
      conversationId: uid(10),
      persisted: true,
      sortOrder: 2,
    });
    expect(realtime.agentEvent).toHaveBeenCalledWith(uid(1), "workspace.tab_opened", {
      conversationId: uid(10),
      sortOrder: 2,
      lastOpenedAt: at.toISOString(),
    });
  });

  it("does not open a tab for a conversation the agent cannot see", async () => {
    conversations.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.openTab(agent, uid(10))).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.upsertTab).not.toHaveBeenCalled();
  });

  it("stores nothing when persistence is off", async () => {
    repo.findPreferences.mockResolvedValue({ persistTabs: false });
    await expect(service.openTab(agent, uid(10))).resolves.toEqual({
      conversationId: uid(10),
      persisted: false,
      sortOrder: null,
    });
    expect(repo.upsertTab).not.toHaveBeenCalled();
    expect(realtime.agentEvent).not.toHaveBeenCalled();
  });

  it("refuses a 21st tab but still refreshes an already open one", async () => {
    repo.countTabs.mockResolvedValue(20);
    repo.upsertTab.mockResolvedValue({ sortOrder: 0, lastOpenedAt: at });
    repo.hasTab.mockResolvedValue(false);
    await expect(service.openTab(agent, uid(10))).rejects.toBeInstanceOf(ConflictError);
    repo.hasTab.mockResolvedValue(true);
    await expect(service.openTab(agent, uid(10))).resolves.toMatchObject({ persisted: true });
  });

  it("still succeeds when the realtime push fails", async () => {
    repo.hasTab.mockResolvedValue(true);
    repo.upsertTab.mockResolvedValue({ sortOrder: 0, lastOpenedAt: at });
    realtime.agentEvent.mockRejectedValue(new Error("redis down"));
    await expect(service.openTab(agent, uid(10))).resolves.toMatchObject({ persisted: true });
  });
});

describe("closeTab", () => {
  it("only removes the tab and announces it, without any conversation change or access check", async () => {
    repo.deleteTab.mockResolvedValue(true);
    await service.closeTab(agent, uid(10));
    expect(repo.deleteTab).toHaveBeenCalledWith(uid(1), uid(10));
    expect(conversations.requireVisible).not.toHaveBeenCalled();
    expect(realtime.conversationEvent).not.toHaveBeenCalled();
    expect(realtime.agentEvent).toHaveBeenCalledWith(uid(1), "workspace.tab_closed", { conversationId: uid(10) });
  });

  it("is quiet when the tab was already closed", async () => {
    repo.deleteTab.mockResolvedValue(false);
    await expect(service.closeTab(agent, uid(10))).resolves.toEqual({ conversationId: uid(10) });
    expect(realtime.agentEvent).not.toHaveBeenCalled();
  });
});

describe("drafts", () => {
  it("saves the draft for this agent and conversation and announces it", async () => {
    repo.upsertDraft.mockResolvedValue({ content: "Hello", updatedAt: at });
    await expect(service.saveDraft(agent, uid(10), { content: "Hello" })).resolves.toEqual({
      conversationId: uid(10),
      content: "Hello",
      updatedAt: at.toISOString(),
    });
    expect(repo.upsertDraft).toHaveBeenCalledWith(uid(1), uid(10), "Hello");
    expect(realtime.agentEvent).toHaveBeenCalledWith(uid(1), "workspace.draft_updated", {
      conversationId: uid(10),
      content: "Hello",
      updatedAt: at.toISOString(),
    });
  });

  it("treats an empty draft as a delete", async () => {
    repo.deleteDraft.mockResolvedValue(true);
    await expect(service.saveDraft(agent, uid(10), { content: "" })).resolves.toBeNull();
    expect(repo.upsertDraft).not.toHaveBeenCalled();
    expect(realtime.agentEvent).toHaveBeenCalledWith(
      uid(1),
      "workspace.draft_updated",
      expect.objectContaining({ content: null }),
    );
  });

  it("refuses to save a draft for a conversation the agent cannot see", async () => {
    conversations.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.saveDraft(agent, uid(10), { content: "x" })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.upsertDraft).not.toHaveBeenCalled();
  });

  it("discards a draft even after the conversation became hidden", async () => {
    repo.deleteDraft.mockResolvedValue(true);
    await service.clearDraft(agent, uid(10));
    expect(conversations.requireVisible).not.toHaveBeenCalled();
    expect(repo.deleteDraft).toHaveBeenCalledWith(uid(1), uid(10));
  });
});
