import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import type { NotificationService } from "@modules/notifications/index.js";
import type { AssignmentRepository } from "../assignment.repository.js";
import { AssignmentService } from "../assignment.service.js";
import type { ConversationState } from "../assignment.types.js";
import { uid } from "../../../__tests__/support/ids.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const systemMessages = { post: vi.fn() };
const realtime = fakeRealtime();

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
  systemMessages,
  realtime,
);

const agent: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };

const state = (patch: Partial<ConversationState> = {}): ConversationState => ({
  id: uid(10),
  status: "OPEN",
  handoffStatus: "NEEDS_HUMAN",
  assignedAgentId: null,
  isArchived: false,
  ...patch,
});
const owned = (owner: string) => state({ handoffStatus: "ASSIGNED", assignedAgentId: owner });
const assignmentRow = fromPartial<Awaited<ReturnType<AssignmentRepository["createOwner"]>>>({
  id: uid(1),
  conversationId: uid(10),
  agentId: uid(1),
  assignedBy: uid(1),
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
  systemMessages.post.mockResolvedValue(undefined);
  realtime.conversationEvent.mockClear();
});

describe("assign", () => {
  it("lets an agent take over a waiting conversation and records the full history", async () => {
    repo.findState.mockResolvedValue(state());
    const result = await service.assign(agent, uid(10), {});
    expect(repo.claim).toHaveBeenCalledWith(state(), uid(1));
    expect(repo.createOwner).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: uid(1), assignedBy: uid(1), action: "TAKEOVER" }),
    );
    expect(repo.joinAsOwner).toHaveBeenCalledWith(uid(10), uid(1));
    expect(repo.addActivity).toHaveBeenCalledWith(expect.objectContaining({ activityType: "ASSIGNED" }));
    expect(result.action).toBe("TAKEOVER");
    expect(realtime.conversationEvent).toHaveBeenCalledWith(
      uid(10),
      "assigned",
      expect.objectContaining({ agentId: uid(1), assignedBy: uid(1), action: "TAKEOVER" }),
      [],
    );
    expect(systemMessages.post).toHaveBeenCalledWith(
      uid(10),
      `Agent ${uid(1)} took over the conversation`,
      expect.objectContaining({ event: "takeover" }),
    );
    expect(notifications.notifyAgent).not.toHaveBeenCalled(); // no self-notification
  });

  it("loses cleanly when another agent claimed it first", async () => {
    repo.findState.mockResolvedValue(state());
    repo.claim.mockResolvedValue(false);
    await expect(service.assign(agent, uid(10), {})).rejects.toBeInstanceOf(ConflictError);
    expect(repo.createOwner).not.toHaveBeenCalled();
    expect(repo.addActivity).not.toHaveBeenCalled();
  });

  it("forbids agents from taking AI-handled conversations and from assigning others, and hides owned ones", async () => {
    repo.findState.mockResolvedValue(state({ handoffStatus: "NONE" }));
    await expect(service.assign(agent, uid(10), {})).rejects.toBeInstanceOf(ForbiddenError);
    repo.findState.mockResolvedValue(state());
    await expect(service.assign(agent, uid(10), { agentId: uid(3) })).rejects.toBeInstanceOf(ForbiddenError);
    repo.findState.mockResolvedValue(owned(uid(2)));
    await expect(service.assign(agent, uid(10), {})).rejects.toBeInstanceOf(NotFoundError); // not visible to them
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it("lets a supervisor assign another agent and notifies them", async () => {
    repo.findState.mockResolvedValue(state());
    await service.assign(supervisor, uid(10), { agentId: uid(3), note: "VIP" });
    expect(repo.createOwner).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: uid(3), assignedBy: uid(9), action: "ASSIGNED", note: "VIP" }),
    );
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: uid(3), type: "ASSIGNED", conversationId: uid(10) }),
    );
  });

  it("transfers from the previous owner when a supervisor reassigns, notifying both", async () => {
    repo.findState.mockResolvedValue(owned(uid(2)));
    await service.assign(supervisor, uid(10), { agentId: uid(3) });
    expect(repo.leaveParticipant).toHaveBeenCalledWith(uid(10), uid(2));
    // The previous owner no longer sees the chat, so they are named explicitly to be told it moved.
    expect(realtime.conversationEvent).toHaveBeenCalledWith(uid(10), "transferred", expect.anything(), [uid(2)]);
    expect(repo.addActivity).toHaveBeenCalledWith(expect.objectContaining({ activityType: "TRANSFERRED" }));
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: uid(3), type: "TRANSFERRED" }),
    );
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: uid(2), type: "TRANSFERRED" }),
    );
  });

  it("rejects missing, closed and already-assigned conversations", async () => {
    repo.findState.mockResolvedValue(null);
    await expect(service.assign(agent, uid(10), {})).rejects.toBeInstanceOf(NotFoundError);
    repo.findState.mockResolvedValue(state({ status: "CLOSED" }));
    await expect(service.assign(agent, uid(10), {})).rejects.toBeInstanceOf(ConflictError);
    repo.findState.mockResolvedValue(owned(uid(1)));
    await expect(service.assign(agent, uid(10), {})).rejects.toBeInstanceOf(ConflictError);
  });

  it("does not fail the assignment when the notification or system message fails", async () => {
    repo.findState.mockResolvedValue(state());
    notifications.notifyAgent.mockRejectedValue(new Error("db down"));
    systemMessages.post.mockRejectedValue(new Error("db down"));
    await expect(service.assign(supervisor, uid(10), { agentId: uid(3) })).resolves.toBeDefined();
  });
});

describe("transfer", () => {
  it("lets the owner transfer to another agent", async () => {
    repo.findState.mockResolvedValue(owned(uid(1)));
    await service.transfer(agent, uid(10), { agentId: uid(3) });
    expect(repo.createOwner).toHaveBeenCalledWith(expect.objectContaining({ agentId: uid(3), action: "TRANSFERRED" }));
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: uid(3), type: "TRANSFERRED" }),
    );
  });

  it("hides others' chats, requires an owner, and rejects transferring to the owner", async () => {
    repo.findState.mockResolvedValue(owned(uid(2)));
    await expect(service.transfer(agent, uid(10), { agentId: uid(3) })).rejects.toBeInstanceOf(NotFoundError);
    repo.findState.mockResolvedValue(state());
    await expect(service.transfer(agent, uid(10), { agentId: uid(3) })).rejects.toBeInstanceOf(ForbiddenError);
    repo.findState.mockResolvedValue(owned(uid(1)));
    await expect(service.transfer(agent, uid(10), { agentId: uid(1) })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("unassign", () => {
  it("returns the conversation to the queue and notifies a previous owner removed by a supervisor", async () => {
    repo.findState.mockResolvedValue(owned(uid(2)));
    const result = await service.unassign(supervisor, uid(10), {});
    expect(repo.release).toHaveBeenCalled();
    expect(repo.endOwner).toHaveBeenCalledWith(uid(10), uid(9));
    expect(repo.leaveParticipant).toHaveBeenCalledWith(uid(10), uid(2));
    expect(repo.addActivity).toHaveBeenCalledWith(expect.objectContaining({ activityType: "UNASSIGNED" }));
    expect(result).toEqual({ conversationId: uid(10), assignedAgentId: null });
    expect(realtime.conversationEvent).toHaveBeenCalledWith(uid(10), "updated", expect.anything(), [uid(2)]);
    expect(notifications.notifyAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: uid(2) }));
  });

  it("hides others' chats, forbids unassigning an unowned one, and conflicts when ownership changed concurrently", async () => {
    repo.findState.mockResolvedValue(owned(uid(2)));
    await expect(service.unassign(agent, uid(10), {})).rejects.toBeInstanceOf(NotFoundError);
    repo.findState.mockResolvedValue(state());
    await expect(service.unassign(agent, uid(10), {})).rejects.toBeInstanceOf(ForbiddenError);
    repo.findState.mockResolvedValue(owned(uid(1)));
    repo.release.mockResolvedValue(false);
    await expect(service.unassign(agent, uid(10), {})).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("history", () => {
  it("hides the history of another agent's conversation from agents", async () => {
    repo.findState.mockResolvedValue(owned(uid(2)));
    await expect(service.history(agent, uid(10))).rejects.toBeInstanceOf(NotFoundError);
    repo.history.mockResolvedValue([assignmentRow]);
    await expect(service.history(supervisor, uid(10))).resolves.toHaveLength(1);
    await expect(service.history(other, uid(10))).resolves.toHaveLength(1); // agent 2 owns it
  });
});
