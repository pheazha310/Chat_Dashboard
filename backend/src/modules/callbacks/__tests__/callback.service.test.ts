import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { CallbackRepository, CallbackRow } from "../callback.repository.js";
import { CallbackService } from "../callback.service.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const repo = {
  inTransaction: vi.fn(),
  findById: vi.fn(),
  listForConversation: vi.fn(),
  list: vi.fn(),
  countPending: vi.fn(),
  create: vi.fn(),
  reopenWith: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
  claimMissed: vi.fn(),
  claimReminders: vi.fn(),
  addActivity: vi.fn(),
};
const conversations = { requireVisible: vi.fn() };
const directory = { getAgents: vi.fn(), getCustomer: vi.fn(), source: "test" };
const notifications = { notifyAgent: vi.fn() };
const realtime = fakeRealtime();
const now = new Date("2030-01-01T10:00:00Z");
const service = new CallbackService(
  fromPartial<CallbackRepository>(repo),
  () => conversations,
  directory,
  notifications,
  realtime,
  { reminderLeadMs: 10 * 60_000, missedAfterMs: 15 * 60_000 },
  () => now,
);

const agent: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const inAnHour = new Date(now.getTime() + 3_600_000);

const row = (patch: Partial<CallbackRow> = {}) =>
  fromPartial<CallbackRow>({
    id: uid(50),
    conversationId: uid(10),
    customerId: uid(100),
    assignedAgentId: uid(1),
    createdBy: uid(1),
    scheduledAt: inAnHour,
    status: "PENDING",
    notes: null,
    completionNote: null,
    createdAt: now,
    completedAt: null,
    ...patch,
  });

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  repo.countPending.mockResolvedValue(0);
  repo.addActivity.mockResolvedValue(undefined);
  repo.claimMissed.mockResolvedValue([]);
  repo.claimReminders.mockResolvedValue([]);
  notifications.notifyAgent.mockResolvedValue(true);
  conversations.requireVisible.mockResolvedValue({ id: uid(10), customerId: uid(100), assignedAgentId: uid(1) });
  directory.getAgents.mockImplementation(async (ids: string[]) =>
    ids.map((id) => ({ id, name: "A", avatarUrl: null })),
  );
});

describe("create", () => {
  it("schedules for the conversation's owner, records it and tells the conversation's viewers", async () => {
    repo.create.mockResolvedValue(row());
    const result = await service.create(agent, uid(10), { scheduledAt: inAnHour, notes: "after 5pm" });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ assignedAgentId: uid(1), createdBy: uid(1), customerId: uid(100), notes: "after 5pm" }),
    );
    expect(repo.addActivity).toHaveBeenCalledWith(
      uid(10),
      { type: "AGENT", id: uid(1) },
      "Callback scheduled",
      expect.objectContaining({ action: "created" }),
    );
    expect(result.permissions).toEqual({ canEdit: true, canComplete: true, canCancel: true });
    expect(realtime.messageEvent).toHaveBeenCalledWith(
      uid(10),
      "callback.created",
      expect.objectContaining({ callback: expect.not.objectContaining({ permissions: expect.anything() }) }),
    );
    expect(notifications.notifyAgent).not.toHaveBeenCalled(); // assigned to oneself: nothing to tell
  });

  it("assigns to the caller when nobody owns the conversation", async () => {
    conversations.requireVisible.mockResolvedValue({ id: uid(10), customerId: uid(100), assignedAgentId: null });
    repo.create.mockResolvedValue(row());
    await service.create(other, uid(10), { scheduledAt: inAnHour });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ assignedAgentId: uid(2) }));
  });

  it("notifies another assignee, after checking they exist and can see the conversation", async () => {
    repo.create.mockResolvedValue(row({ assignedAgentId: uid(3) }));
    await service.create(agent, uid(10), { scheduledAt: inAnHour, assignedAgentId: uid(3) });

    expect(conversations.requireVisible).toHaveBeenCalledWith({ userId: uid(3), role: "AGENT" }, uid(10));
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: uid(3), type: "CALLBACK", conversationId: uid(10) }),
    );
  });

  it("rejects an unknown assignee and one who cannot see the conversation, storing nothing", async () => {
    directory.getAgents.mockResolvedValueOnce([]);
    await expect(
      service.create(agent, uid(10), { scheduledAt: inAnHour, assignedAgentId: uid(3) }),
    ).rejects.toBeInstanceOf(BadRequestError);

    conversations.requireVisible
      .mockResolvedValueOnce({ id: uid(10), customerId: uid(100), assignedAgentId: uid(1) })
      .mockRejectedValueOnce(new NotFoundError("hidden"));
    await expect(
      service.create(agent, uid(10), { scheduledAt: inAnHour, assignedAgentId: uid(3) }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("refuses times in the past, now, and more than a year ahead", async () => {
    for (const at of [new Date(now.getTime() - 1000), now, new Date(now.getTime() + 366 * 86_400_000)]) {
      await expect(service.create(agent, uid(10), { scheduledAt: at })).rejects.toBeInstanceOf(BadRequestError);
    }
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("refuses a conversation without a customer and one with too many pending callbacks", async () => {
    conversations.requireVisible.mockResolvedValueOnce({ id: uid(10), customerId: null, assignedAgentId: null });
    await expect(service.create(agent, uid(10), { scheduledAt: inAnHour })).rejects.toBeInstanceOf(ConflictError);

    repo.countPending.mockResolvedValue(20);
    await expect(service.create(agent, uid(10), { scheduledAt: inAnHour })).rejects.toBeInstanceOf(ConflictError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("still succeeds when notifications and realtime fail", async () => {
    repo.create.mockResolvedValue(row({ assignedAgentId: uid(3) }));
    notifications.notifyAgent.mockRejectedValue(new Error("down"));
    realtime.messageEvent.mockRejectedValue(new Error("redis down"));
    await expect(
      service.create(agent, uid(10), { scheduledAt: inAnHour, assignedAgentId: uid(3) }),
    ).resolves.toMatchObject({ id: uid(50) });
  });
});

describe("who may change a callback", () => {
  it("lets the assignee, the creator and supervisors, but not another agent who can merely see it", async () => {
    repo.findById.mockResolvedValue(row({ assignedAgentId: uid(3), createdBy: uid(4) }));
    repo.cancel.mockResolvedValue(row({ status: "CANCELLED" }));
    await expect(service.cancel(other, uid(50))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.cancel(supervisor, uid(50))).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(service.cancel({ userId: uid(3), role: "AGENT" }, uid(50))).resolves.toBeDefined();
    await expect(service.cancel({ userId: uid(4), role: "AGENT" }, uid(50))).resolves.toBeDefined();
  });

  it("answers 404 when the caller is not involved and cannot see the conversation", async () => {
    repo.findById.mockResolvedValue(row({ assignedAgentId: uid(3), createdBy: uid(4) }));
    conversations.requireVisible.mockRejectedValue(new NotFoundError("hidden"));
    await expect(service.get(other, uid(50))).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.cancel(other, uid(50))).rejects.toBeInstanceOf(NotFoundError);
    repo.findById.mockResolvedValue(null);
    await expect(service.get(supervisor, uid(50))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to change a closed callback, and reports losing a race as a conflict", async () => {
    repo.findById.mockResolvedValue(row({ status: "COMPLETED" }));
    await expect(service.complete(agent, uid(50), {})).rejects.toBeInstanceOf(ConflictError);

    repo.findById.mockResolvedValue(row());
    repo.complete.mockResolvedValue(null); // someone completed it between the read and the write
    await expect(service.complete(agent, uid(50), {})).rejects.toBeInstanceOf(ConflictError);
    expect(repo.addActivity).not.toHaveBeenCalled();
  });

  it("completes a missed callback too", async () => {
    repo.findById.mockResolvedValue(row({ status: "MISSED" }));
    repo.complete.mockResolvedValue(row({ status: "COMPLETED", completionNote: "reached", completedAt: now }));
    const result = await service.complete(agent, uid(50), { completionNote: "reached" });
    expect(result).toMatchObject({ status: "COMPLETED", completionNote: "reached" });
    expect(result.permissions.canEdit).toBe(false);
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "callback.completed", expect.anything());
  });
});

describe("update", () => {
  it("notifies a new assignee but not when the caller hands it to themselves", async () => {
    repo.findById.mockResolvedValue(row());
    repo.reopenWith.mockResolvedValue(row({ assignedAgentId: uid(3) }));
    await service.update(agent, uid(50), { assignedAgentId: uid(3) });
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: uid(3), title: "Callback assigned to you" }),
    );

    notifications.notifyAgent.mockClear();
    repo.findById.mockResolvedValue(row({ assignedAgentId: uid(3) }));
    repo.reopenWith.mockResolvedValue(row({ assignedAgentId: uid(9) }));
    await service.update(supervisor, uid(50), { assignedAgentId: uid(9) });
    expect(notifications.notifyAgent).not.toHaveBeenCalled();
  });

  it("validates a new time and ignores an assignee that did not change", async () => {
    repo.findById.mockResolvedValue(row());
    await expect(service.update(agent, uid(50), { scheduledAt: new Date(now.getTime() - 1) })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    repo.reopenWith.mockResolvedValue(row());
    await service.update(agent, uid(50), { assignedAgentId: uid(1), notes: "x" });
    expect(repo.reopenWith).toHaveBeenCalledWith(uid(50), { notes: "x" });
    expect(directory.getAgents).not.toHaveBeenCalled();
  });
});

describe("list", () => {
  it("shows an agent only their own callbacks and keeps 'all' for supervisors", async () => {
    repo.list.mockResolvedValue({ items: [row()], total: 1 });
    await service.list(agent, { page: 1, size: 25, scope: "mine" });
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ involving: uid(1) }), 0, 25);

    await expect(service.list(agent, { page: 1, size: 25, scope: "all" })).rejects.toBeInstanceOf(ForbiddenError);
    await service.list(supervisor, { page: 2, size: 10, scope: "all" });
    expect(repo.list).toHaveBeenLastCalledWith(expect.objectContaining({ involving: undefined }), 10, 10);
  });
});

describe("processDue", () => {
  it("reminds the assignee with a stored notification and a live event, and marks the overdue as missed", async () => {
    repo.claimMissed.mockResolvedValue([row({ id: uid(51), assignedAgentId: uid(2) })]);
    repo.claimReminders.mockResolvedValue([row()]);

    expect(await service.processDue(now)).toEqual({ missed: 1, reminded: 1 });

    expect(repo.claimMissed).toHaveBeenCalledWith(new Date("2030-01-01T09:45:00Z"), 100);
    expect(repo.claimReminders).toHaveBeenCalledWith(
      new Date("2030-01-01T10:10:00Z"),
      new Date("2030-01-01T09:45:00Z"),
      100,
    );
    expect(repo.addActivity).toHaveBeenCalledWith(
      uid(10),
      { type: "SYSTEM", id: null },
      "Callback missed",
      expect.objectContaining({ action: "missed" }),
    );
    expect(notifications.notifyAgent.mock.calls.map(([input]) => [input.agentId, input.title])).toEqual([
      [uid(2), "Missed callback"],
      [uid(1), "Callback reminder"],
    ]);
    expect(realtime.agentEvent).toHaveBeenCalledWith(uid(1), "callback.reminder", expect.anything());
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "callback.missed", expect.anything());
  });

  it("does nothing when nothing is due, and survives a failing notification", async () => {
    expect(await service.processDue(now)).toEqual({ missed: 0, reminded: 0 });
    expect(notifications.notifyAgent).not.toHaveBeenCalled();

    repo.claimReminders.mockResolvedValue([row(), row({ id: uid(52) })]);
    notifications.notifyAgent.mockRejectedValue(new Error("down"));
    expect(await service.processDue(now)).toEqual({ missed: 0, reminded: 2 });
  });
});
