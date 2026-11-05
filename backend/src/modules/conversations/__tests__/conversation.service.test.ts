import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { ConversationRepository } from "../conversation.repository.js";
import { ConversationService } from "../conversation.service.js";
import type { AccessibleConversation } from "../conversation.types.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const systemMessages = { post: vi.fn() };
const repo = {
  listInbox: vi.fn(),
  unreadCounts: vi.fn(),
  unreadConversationIds: vi.fn(),
  findForAccess: vi.fn(),
  findByApplication: vi.fn(),
  lockCustomer: vi.fn(),
  create: vi.fn(),
  addCustomerParticipant: vi.fn(),
  transitionStatus: vi.fn(),
  releaseOwner: vi.fn(),
  setArchived: vi.fn(),
  addActivity: vi.fn(),
  listActivities: vi.fn(),
  inTransaction: vi.fn(),
};
const service = new ConversationService(fromPartial<ConversationRepository>(repo), systemMessages);

const agent: AuthContext = { userId: 1n, role: "AGENT" };
const other: AuthContext = { userId: 2n, role: "AGENT" };
const supervisor: AuthContext = { userId: 9n, role: "SUPERVISOR" };
const now = new Date("2026-01-01T00:00:00Z");

const row = (patch: Partial<AccessibleConversation> = {}): AccessibleConversation =>
  fromPartial<AccessibleConversation>({
    id: 10n,
    customerId: 100n,
    applicationId: null,
    customerName: "Maya Chen",
    customerIdentifier: "C-1",
    subject: null,
    summary: null,
    status: "OPEN",
    priority: "MEDIUM",
    conversationMode: "HUMAN",
    handoffStatus: "ASSIGNED",
    assignedAgentId: 1n,
    isArchived: false,
    lastMessageAt: now,
    lastMessagePreview: "hi",
    lastSequenceNumber: 3n,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    closedAt: null,
    conversationTags: [],
    conversationAssignments: [],
    ...patch,
  });

beforeEach(() => {
  vi.resetAllMocks();
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  repo.unreadCounts.mockResolvedValue(new Map());
  repo.transitionStatus.mockResolvedValue(true);
  repo.setArchived.mockResolvedValue(true);
  systemMessages.post.mockResolvedValue(undefined);
});

describe("list", () => {
  it("returns summaries with per-agent unread counts and pagination meta", async () => {
    repo.listInbox.mockResolvedValue({ items: [row()], total: 51 });
    repo.unreadCounts.mockResolvedValue(new Map([[10n, 4]]));
    const result = await service.list(agent, { filter: "all", page: 2, size: 25 });
    expect(repo.listInbox).toHaveBeenCalledWith(agent, { filter: "all", page: 2, size: 25 }, []);
    expect(repo.unreadCounts).toHaveBeenCalledWith(1n, [10n]);
    expect(result.items[0]).toMatchObject({ id: "10", assignedAgentId: "1", unreadCount: 4, customerId: "100" });
    expect(result.meta).toEqual({ total: 51, page: 2, size: 25, totalPages: 3 });
    expect(repo.unreadConversationIds).not.toHaveBeenCalled();
  });

  it("loads unread ids only for the unread filter", async () => {
    repo.unreadConversationIds.mockResolvedValue([10n]);
    repo.listInbox.mockResolvedValue({ items: [], total: 0 });
    await service.list(agent, { filter: "unread", page: 1, size: 25 });
    expect(repo.unreadConversationIds).toHaveBeenCalledWith(1n);
  });
});

describe("get", () => {
  it("includes the caller's permissions", async () => {
    repo.findForAccess.mockResolvedValue(row());
    const detail = await service.get(agent, 10n);
    expect(detail.permissions.canSendMessage).toBe(true);
    expect(detail.lastSequenceNumber).toBe("3");
  });

  it("hides missing and inaccessible conversations the same way", async () => {
    repo.findForAccess.mockResolvedValue(null);
    await expect(service.get(agent, 10n)).rejects.toBeInstanceOf(NotFoundError);
    repo.findForAccess.mockResolvedValue(row());
    await expect(service.get(other, 10n)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.get(supervisor, 10n)).resolves.toBeDefined();
  });

  it("lets a viewer open another agent's conversation", async () => {
    repo.findForAccess.mockResolvedValue(row({ conversationAssignments: [{ assignmentType: "VIEWER" }] }));
    await expect(service.get(other, 10n)).resolves.toBeDefined();
  });
});

describe("create", () => {
  const input = { customerId: 100n, applicationId: 7n, priority: "MEDIUM" as const };

  it("creates a queued human conversation with a customer participant", async () => {
    repo.findByApplication.mockResolvedValue(null);
    repo.create.mockResolvedValue(row());
    repo.findForAccess.mockResolvedValue(row({ handoffStatus: "NEEDS_HUMAN", assignedAgentId: null }));
    const result = await service.create(agent, input);
    expect(result.created).toBe(true);
    expect(repo.lockCustomer).toHaveBeenCalledWith(100n);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByType: "AGENT",
        createdById: 1n,
        handoffStatus: "NEEDS_HUMAN",
        conversationMode: "HUMAN",
      }),
    );
    expect(repo.addCustomerParticipant).toHaveBeenCalledWith(10n, 100n);
  });

  it("returns the existing open conversation for the application instead of duplicating", async () => {
    repo.findByApplication.mockResolvedValue(row());
    repo.findForAccess.mockResolvedValue(row());
    const result = await service.create(agent, input);
    expect(result.created).toBe(false);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects an application that belongs to another customer", async () => {
    repo.findByApplication.mockResolvedValue(row({ customerId: 555n }));
    await expect(service.create(agent, input)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("changeStatus", () => {
  it("resolves as owner, releases the agent and records the activity", async () => {
    repo.findForAccess.mockResolvedValue(row());
    await service.changeStatus(agent, 10n, "RESOLVED");
    expect(repo.transitionStatus).toHaveBeenCalledWith(
      10n,
      "OPEN",
      expect.objectContaining({ status: "RESOLVED", handoffStatus: "NONE", assignedAgentId: null }),
    );
    expect(repo.releaseOwner).toHaveBeenCalledWith(10n, 1n, 1n);
    expect(systemMessages.post).toHaveBeenCalledWith(
      10n,
      "Agent 1 resolved the conversation",
      expect.objectContaining({ to: "RESOLVED" }),
    );
    expect(repo.addActivity).toHaveBeenCalledWith(
      expect.objectContaining({ activityType: "STATUS_CHANGED", metadata: { from: "OPEN", to: "RESOLVED" } }),
    );
  });

  it("denies resolving a conversation the caller does not own", async () => {
    repo.findForAccess.mockResolvedValue(row({ handoffStatus: "NEEDS_HUMAN", assignedAgentId: null }));
    await expect(service.changeStatus(agent, 10n, "RESOLVED")).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.transitionStatus).not.toHaveBeenCalled();
  });

  it("lets a supervisor close and any viewer reopen; reopening queues an unowned chat", async () => {
    repo.findForAccess.mockResolvedValue(row({ status: "RESOLVED", handoffStatus: "NONE", assignedAgentId: null }));
    await service.changeStatus(other, 10n, "OPEN");
    expect(repo.transitionStatus).toHaveBeenCalledWith(
      10n,
      "RESOLVED",
      expect.objectContaining({ status: "OPEN", resolvedAt: null, closedAt: null, handoffStatus: "NEEDS_HUMAN" }),
    );
    expect(repo.releaseOwner).not.toHaveBeenCalled();
    await service.changeStatus(supervisor, 10n, "CLOSED");
  });

  it("rejects no-op transitions and lost races", async () => {
    repo.findForAccess.mockResolvedValue(row());
    await expect(service.changeStatus(agent, 10n, "OPEN")).rejects.toBeInstanceOf(ConflictError);
    repo.transitionStatus.mockResolvedValue(false);
    await expect(service.changeStatus(agent, 10n, "RESOLVED")).rejects.toBeInstanceOf(ConflictError);
    expect(repo.addActivity).not.toHaveBeenCalled();
  });
});

describe("archive / restore", () => {
  it("archives as owner and records the activity", async () => {
    repo.findForAccess.mockResolvedValue(row());
    await service.archive(agent, 10n);
    expect(repo.setArchived).toHaveBeenCalledWith(10n, true);
    expect(repo.addActivity).toHaveBeenCalledWith(expect.objectContaining({ activityType: "ARCHIVED" }));
  });

  it("denies a non-owner, rejects double-archive, and restores", async () => {
    repo.findForAccess.mockResolvedValue(row());
    await expect(service.archive(supervisorLike(), 10n)).resolves.toBeDefined();
    await expect(service.archive(other, 10n)).rejects.toBeInstanceOf(NotFoundError); // cannot even see it
    repo.findForAccess.mockResolvedValue(row({ isArchived: true }));
    await expect(service.archive(agent, 10n)).rejects.toBeInstanceOf(ConflictError);
    await service.restore(agent, 10n);
    expect(repo.addActivity).toHaveBeenLastCalledWith(expect.objectContaining({ activityType: "RESTORED" }));
  });
});

describe("activities", () => {
  it("checks access before listing", async () => {
    repo.findForAccess.mockResolvedValue(null);
    await expect(service.activities(agent, 10n, { page: 1, size: 25 })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.listActivities).not.toHaveBeenCalled();
  });
});

function supervisorLike() {
  return supervisor;
}
