import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { TagRepository, TagWithUsage } from "../tag.repository.js";
import { TagService } from "../tag.service.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const repo = {
  inTransaction: vi.fn(),
  list: vi.fn(),
  findById: vi.fn(),
  findByName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  conversationIdsUsing: vi.fn(),
  existingIds: vi.fn(),
  lockConversation: vi.fn(),
  tagsOf: vi.fn(),
  tagsByIds: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  addActivities: vi.fn(),
};
const access = { requireVisible: vi.fn() };
const realtime = fakeRealtime();
const service = new TagService(fromPartial<TagRepository>(repo), () => access, realtime);

const agent: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const at = new Date("2026-01-01T00:00:00Z");
const tag = (id: string, name = id, patch = {}): TagWithUsage =>
  fromPartial<TagWithUsage>({
    id,
    name,
    color: null,
    createdBy: uid(1),
    createdAt: at,
    _count: { conversationTags: 0 },
    ...patch,
  });
const state = (patch = {}) => ({
  id: uid(10),
  status: "OPEN",
  handoffStatus: "ASSIGNED",
  assignedAgentId: uid(1),
  isArchived: false,
  customerId: uid(100),
  ...patch,
});

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  repo.findByName.mockResolvedValue(null);
  repo.conversationIdsUsing.mockResolvedValue([]);
  access.requireVisible.mockResolvedValue(state());
});

describe("create and update", () => {
  it("creates a tag owned by the caller, refusing a name that exists in any letter case", async () => {
    repo.create.mockResolvedValue(tag(uid(30), "VIP", { color: "#ff0000" }));
    await expect(service.create(agent, { name: "VIP", color: "#ff0000" })).resolves.toMatchObject({
      name: "VIP",
      usageCount: 0,
    });
    expect(repo.create).toHaveBeenCalledWith({ name: "VIP", color: "#ff0000", createdBy: uid(1) });
    repo.findByName.mockResolvedValue(tag(uid(31), "vip"));
    await expect(service.create(agent, { name: "VIP" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets the creator or a supervisor change a tag, and tells conversations that use it", async () => {
    repo.findById.mockResolvedValue(tag(uid(30), "VIP"));
    repo.update.mockResolvedValue(tag(uid(30), "Gold"));
    repo.conversationIdsUsing.mockResolvedValue([uid(10), uid(11)]);
    await service.update(agent, uid(30), { name: "Gold" });
    await service.update(supervisor, uid(30), { color: null });
    expect(repo.update).toHaveBeenLastCalledWith(uid(30), { color: null });
    expect(realtime.conversationEvent).toHaveBeenCalledWith(uid(10), "tags_updated");
    expect(realtime.conversationEvent).toHaveBeenCalledTimes(4);
    await expect(service.update(other, uid(30), { name: "X" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows a change of letter case but not a clash with another tag", async () => {
    repo.findById.mockResolvedValue(tag(uid(30), "vip"));
    repo.update.mockResolvedValue(tag(uid(30), "VIP"));
    await service.update(agent, uid(30), { name: "VIP" });
    expect(repo.findByName).not.toHaveBeenCalled();
    repo.findByName.mockResolvedValue(tag(uid(31), "Gold"));
    await expect(service.update(agent, uid(30), { name: "gold" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("answers 404 for an unknown tag", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.update(agent, uid(30), { name: "X" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("remove", () => {
  beforeEach(() => repo.findById.mockResolvedValue(tag(uid(30), "VIP")));

  it("is for supervisors only", async () => {
    await expect(service.remove(agent, uid(30), { force: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("deletes an unused tag", async () => {
    repo.delete.mockResolvedValue(true);
    await expect(service.remove(supervisor, uid(30), { force: false })).resolves.toEqual({
      id: uid(30),
      removedFromConversations: 0,
    });
  });

  it("refuses a tag in use unless forced, and says how many conversations use it", async () => {
    repo.conversationIdsUsing.mockResolvedValue([uid(10), uid(11)]);
    await expect(service.remove(supervisor, uid(30), { force: false })).rejects.toMatchObject({
      status: 409,
      details: { usageCount: 2 },
    });
    expect(repo.delete).not.toHaveBeenCalled();
    expect(repo.addActivities).not.toHaveBeenCalled();
  });

  it("with force, records the removal on each conversation, deletes the tag, then announces", async () => {
    repo.conversationIdsUsing.mockResolvedValue([uid(10), uid(11)]);
    repo.delete.mockResolvedValue(true);
    await expect(service.remove(supervisor, uid(30), { force: true })).resolves.toEqual({
      id: uid(30),
      removedFromConversations: 2,
    });
    expect(repo.addActivities).toHaveBeenCalledWith([
      expect.objectContaining({ conversationId: uid(10), type: "TAG_REMOVED", agentId: uid(9) }),
      expect.objectContaining({ conversationId: uid(11), type: "TAG_REMOVED" }),
    ]);
    expect(realtime.conversationEvent).toHaveBeenCalledTimes(2);
  });

  it("does not announce anything when the delete is lost to another request", async () => {
    repo.delete.mockResolvedValue(false);
    await expect(service.remove(supervisor, uid(30), { force: false })).rejects.toBeInstanceOf(NotFoundError);
    expect(realtime.conversationEvent).not.toHaveBeenCalled();
  });
});

describe("setConversationTags", () => {
  beforeEach(() => {
    repo.existingIds.mockImplementation(async (ids: string[]) => new Set(ids));
    repo.tagsOf
      .mockResolvedValueOnce([tag(uid(30), "VIP"), tag(uid(31), "Late")])
      .mockResolvedValueOnce([tag(uid(31), "Late"), tag(uid(32), "Docs")]);
    repo.tagsByIds.mockImplementation(async (ids: string[]) => ids.map((id) => tag(id, "Docs")));
  });

  it("adds and removes the difference, records each change and announces once", async () => {
    const result = await service.setConversationTags(agent, uid(10), { tagIds: [uid(31), uid(32)] });
    expect(repo.lockConversation).toHaveBeenCalledWith(uid(10));
    expect(repo.unlink).toHaveBeenCalledWith(uid(10), [uid(30)]);
    expect(repo.link).toHaveBeenCalledWith(uid(10), [uid(32)]);
    expect(repo.addActivities).toHaveBeenCalledWith([
      expect.objectContaining({ type: "TAG_ADDED", tag: expect.objectContaining({ id: uid(32) }) }),
      expect.objectContaining({ type: "TAG_REMOVED", tag: expect.objectContaining({ id: uid(30) }) }),
    ]);
    expect(result.tags.map((t) => t.name)).toEqual(["Late", "Docs"]);
    expect(realtime.conversationEvent).toHaveBeenCalledTimes(1);
    expect(realtime.conversationEvent).toHaveBeenCalledWith(uid(10), "tags_updated");
  });

  it("is quiet when nothing changes", async () => {
    repo.tagsOf.mockReset().mockResolvedValue([tag(uid(30), "VIP")]);
    await service.setConversationTags(agent, uid(10), { tagIds: [uid(30)] });
    expect(repo.addActivities).toHaveBeenCalledWith([]);
    expect(realtime.conversationEvent).not.toHaveBeenCalled();
  });

  it("refuses unknown tags, other agents, and hidden conversations", async () => {
    repo.existingIds.mockResolvedValue(new Set([uid(30)]));
    await expect(service.setConversationTags(agent, uid(10), { tagIds: [uid(30), uid(99)] })).rejects.toMatchObject({
      status: 400,
      details: { tagIds: [uid(99)] },
    });
    await expect(service.setConversationTags(agent, uid(10), { tagIds: [uid(99)] })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    access.requireVisible.mockResolvedValue(state({ assignedAgentId: uid(5) }));
    await expect(service.setConversationTags(other, uid(10), { tagIds: [] })).rejects.toBeInstanceOf(ForbiddenError);
    access.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.setConversationTags(other, uid(10), { tagIds: [] })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.link).not.toHaveBeenCalled();
  });

  it("lets a supervisor, and anyone on an unowned conversation, change tags", async () => {
    access.requireVisible.mockResolvedValue(state({ assignedAgentId: uid(5) }));
    await expect(service.setConversationTags(supervisor, uid(10), { tagIds: [] })).resolves.toBeTruthy();
    repo.tagsOf.mockResolvedValue([]);
    access.requireVisible.mockResolvedValue(state({ assignedAgentId: null, handoffStatus: "NEEDS_HUMAN" }));
    await expect(service.setConversationTags(other, uid(10), { tagIds: [] })).resolves.toBeTruthy();
  });
});
