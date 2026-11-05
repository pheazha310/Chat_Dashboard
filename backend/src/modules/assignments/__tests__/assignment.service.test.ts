import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { NotificationService } from "@modules/notifications/index.js";
import type { AssignmentRepository } from "../assignment.repository.js";
import { AssignmentService } from "../assignment.service.js";
import type { ConversationState } from "../assignment.types.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const repo = {
  findState: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  endOwner: vi.fn(),
  createOwner: vi.fn(),
  leaveParticipant: vi.fn(),
  joinAsOwner: vi.fn(),
  addActivity: vi.fn(),
  history: vi.fn(),
  inTransaction: vi.fn(),
};
const notifications = { notifyAgent: vi.fn() };
const service = new AssignmentService(
  fromPartial<AssignmentRepository>(repo),
  fromPartial<NotificationService>(notifications),
);

const agent: AuthContext = { userId: 1n, role: "AGENT" };
const other: AuthContext = { userId: 2n, role: "AGENT" };
const supervisor: AuthContext = { userId: 9n, role: "SUPERVISOR" };

const state = (patch: Partial<ConversationState> = {}): ConversationState => ({
  id: 10n,
  status: "OPEN",
  handoffStatus: "NEEDS_HUMAN",
  assignedAgentId: null,
  isArchived: false,
  ...patch,
});
const owned = (owner: bigint) => state({ handoffStatus: "ASSIGNED", assignedAgentId: owner });
const assignmentRow = fromPartial<Awaited<ReturnType<AssignmentRepository["createOwner"]>>>({
  id: 1n,
  conversationId: 10n,
  agentId: 1n,
  assignedBy: 1n,
  assignmentType: "OWNER",
  assignmentAction: "TAKEOVER",
  note: null,
  assignedAt: new Date("2026-01-01T00:00:00Z"),
  endedAt: null,
  endedBy: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  repo.claim.mockResolvedValue(true);
  repo.release.mockResolvedValue(true);
  repo.createOwner.mockResolvedValue(assignmentRow);
  notifications.notifyAgent.mockResolvedValue(true);
});

describe("assign", () => {
  it("lets an agent take over a waiting conversation and records the full history", async () => {
    repo.findState.mockResolvedValue(state());
    const result = await service.assign(agent, 10n, {});
    expect(repo.claim).toHaveBeenCalledWith(state(), 1n);
    expect(repo.createOwner).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 1n, assignedBy: 1n, action: "TAKEOVER" }),
    );
    expect(repo.joinAsOwner).toHaveBeenCalledWith(10n, 1n);
    expect(repo.addActivity).toHaveBeenCalledWith(expect.objectContaining({ activityType: "ASSIGNED" }));
    expect(result.action).toBe("TAKEOVER");
    expect(notifications.notifyAgent).not.toHaveBeenCalled(); // no self-notification
  });

  it("loses cleanly when another agent claimed it first", async () => {
    repo.findState.mockResolvedValue(state());
    repo.claim.mockResolvedValue(false);
    await expect(service.assign(agent, 10n, {})).rejects.toBeInstanceOf(ConflictError);
    expect(repo.createOwner).not.toHaveBeenCalled();
    expect(repo.addActivity).not.toHaveBeenCalled();
  });

  it("forbids agents from taking AI-handled conversations and from assigning others, and hides owned ones", async () => {
    repo.findState.mockResolvedValue(state({ handoffStatus: "NONE" }));
    await expect(service.assign(agent, 10n, {})).rejects.toBeInstanceOf(ForbiddenError);
    repo.findState.mockResolvedValue(state());
    await expect(service.assign(agent, 10n, { agentId: 3n })).rejects.toBeInstanceOf(ForbiddenError);
    repo.findState.mockResolvedValue(owned(2n));
    await expect(service.assign(agent, 10n, {})).rejects.toBeInstanceOf(NotFoundError); // not visible to them
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it("lets a supervisor assign another agent and notifies them", async () => {
    repo.findState.mockResolvedValue(state());
    await service.assign(supervisor, 10n, { agentId: 3n, note: "VIP" });
    expect(repo.createOwner).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 3n, assignedBy: 9n, action: "ASSIGNED", note: "VIP" }),
    );
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 3n, type: "ASSIGNED", conversationId: 10n }),
    );
  });

  it("transfers from the previous owner when a supervisor reassigns, notifying both", async () => {
    repo.findState.mockResolvedValue(owned(2n));
    await service.assign(supervisor, 10n, { agentId: 3n });
    expect(repo.leaveParticipant).toHaveBeenCalledWith(10n, 2n);
    expect(repo.addActivity).toHaveBeenCalledWith(expect.objectContaining({ activityType: "TRANSFERRED" }));
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 3n, type: "TRANSFERRED" }),
    );
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 2n, type: "TRANSFERRED" }),
    );
  });

  it("rejects missing, closed and already-assigned conversations", async () => {
    repo.findState.mockResolvedValue(null);
    await expect(service.assign(agent, 10n, {})).rejects.toBeInstanceOf(NotFoundError);
    repo.findState.mockResolvedValue(state({ status: "CLOSED" }));
    await expect(service.assign(agent, 10n, {})).rejects.toBeInstanceOf(ConflictError);
    repo.findState.mockResolvedValue(owned(1n));
    await expect(service.assign(agent, 10n, {})).rejects.toBeInstanceOf(ConflictError);
  });

  it("does not fail the assignment when the notification fails", async () => {
    repo.findState.mockResolvedValue(state());
    notifications.notifyAgent.mockRejectedValue(new Error("db down"));
    await expect(service.assign(supervisor, 10n, { agentId: 3n })).resolves.toBeDefined();
  });
});

describe("transfer", () => {
  it("lets the owner transfer to another agent", async () => {
    repo.findState.mockResolvedValue(owned(1n));
    await service.transfer(agent, 10n, { agentId: 3n });
    expect(repo.createOwner).toHaveBeenCalledWith(expect.objectContaining({ agentId: 3n, action: "TRANSFERRED" }));
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 3n, type: "TRANSFERRED" }),
    );
  });

  it("hides others' chats, requires an owner, and rejects transferring to the owner", async () => {
    repo.findState.mockResolvedValue(owned(2n));
    await expect(service.transfer(agent, 10n, { agentId: 3n })).rejects.toBeInstanceOf(NotFoundError);
    repo.findState.mockResolvedValue(state());
    await expect(service.transfer(agent, 10n, { agentId: 3n })).rejects.toBeInstanceOf(ForbiddenError);
    repo.findState.mockResolvedValue(owned(1n));
    await expect(service.transfer(agent, 10n, { agentId: 1n })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("unassign", () => {
  it("returns the conversation to the queue and notifies a previous owner removed by a supervisor", async () => {
    repo.findState.mockResolvedValue(owned(2n));
    const result = await service.unassign(supervisor, 10n, {});
    expect(repo.release).toHaveBeenCalled();
    expect(repo.endOwner).toHaveBeenCalledWith(10n, 9n);
    expect(repo.leaveParticipant).toHaveBeenCalledWith(10n, 2n);
    expect(repo.addActivity).toHaveBeenCalledWith(expect.objectContaining({ activityType: "UNASSIGNED" }));
    expect(result).toEqual({ conversationId: "10", assignedAgentId: null });
    expect(notifications.notifyAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: 2n }));
  });

  it("hides others' chats, forbids unassigning an unowned one, and conflicts when ownership changed concurrently", async () => {
    repo.findState.mockResolvedValue(owned(2n));
    await expect(service.unassign(agent, 10n, {})).rejects.toBeInstanceOf(NotFoundError);
    repo.findState.mockResolvedValue(state());
    await expect(service.unassign(agent, 10n, {})).rejects.toBeInstanceOf(ForbiddenError);
    repo.findState.mockResolvedValue(owned(1n));
    repo.release.mockResolvedValue(false);
    await expect(service.unassign(agent, 10n, {})).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("history", () => {
  it("hides the history of another agent's conversation from agents", async () => {
    repo.findState.mockResolvedValue(owned(2n));
    await expect(service.history(agent, 10n)).rejects.toBeInstanceOf(NotFoundError);
    repo.history.mockResolvedValue([assignmentRow]);
    await expect(service.history(supervisor, 10n)).resolves.toHaveLength(1);
    await expect(service.history(other, 10n)).resolves.toHaveLength(1); // agent 2 owns it
  });
});
