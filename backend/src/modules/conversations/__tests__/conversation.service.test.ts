import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import type { NotificationService } from "@modules/notifications/index.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { ConversationRepository } from "../conversation.repository.js";
import { ConversationService } from "../conversation.service.js";
import type { AccessibleConversation } from "../conversation.types.js";
import { uid } from "../../../__tests__/support/ids.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const systemMessages = { post: vi.fn() };
const realtime = fakeRealtime();
const directory = { source: "test", getAgents: vi.fn(), getCustomer: vi.fn() };
const notifications = { notifyAgent: vi.fn() };
const availableAgents = { availableAgentIds: vi.fn() };
const repo = {
  listInbox: vi.fn(),
  unreadCounts: vi.fn(),
  unreadConversationIds: vi.fn(),
  findForAccess: vi.fn(),
  findManyForAccess: vi.fn(),
  findForEvent: vi.fn(),
  findByApplication: vi.fn(),
  findOpenForCustomer: vi.fn(),
  listForCustomer: vi.fn(),
  lockCustomer: vi.fn(),
  create: vi.fn(),
  addCustomerParticipant: vi.fn(),
  transitionStatus: vi.fn(),
  transitionPriority: vi.fn(),
  releaseOwner: vi.fn(),
  setArchived: vi.fn(),
  addActivity: vi.fn(),
  listActivities: vi.fn(),
  inTransaction: vi.fn(),
};
const identities = { ensureCustomer: vi.fn(async () => {}) };
const service = new ConversationService(
  fromPartial<ConversationRepository>(repo),
  systemMessages,
  realtime,
  directory,
  fromPartial<NotificationService>(notifications),
  availableAgents,
  identities,
);

const agent: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const now = new Date("2026-01-01T00:00:00Z");

const row = (patch: Partial<AccessibleConversation> = {}): AccessibleConversation =>
  fromPartial<AccessibleConversation>({
    id: uid(10),
    customerId: uid(100),
    applicationId: null,
    customerName: "Maya Chen",
    customerIdentifier: "C-1",
    subject: null,
    summary: null,
    status: "OPEN",
    priority: "MEDIUM",
    conversationMode: "HUMAN",
    handoffStatus: "ASSIGNED",
    assignedAgentId: uid(1),
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
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  directory.getAgents.mockResolvedValue([{ id: uid(1), name: "Sarah Chen", avatarUrl: null }]);
  availableAgents.availableAgentIds.mockResolvedValue([]);
  notifications.notifyAgent.mockResolvedValue(true);
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  repo.unreadCounts.mockResolvedValue(new Map());
  repo.transitionStatus.mockResolvedValue(true);
  repo.setArchived.mockResolvedValue(true);
  systemMessages.post.mockResolvedValue(undefined);
});

describe("list", () => {
  it("returns summaries with per-agent unread counts and pagination meta", async () => {
    repo.listInbox.mockResolvedValue({ items: [row()], total: 51 });
    repo.unreadCounts.mockResolvedValue(new Map([[uid(10), 4]]));
    const result = await service.list(agent, { filter: "all", page: 2, size: 25 });
    expect(repo.listInbox).toHaveBeenCalledWith(agent, { filter: "all", page: 2, size: 25 }, []);
    expect(repo.unreadCounts).toHaveBeenCalledWith(uid(1), [uid(10)]);
    expect(result.items[0]).toMatchObject({
      id: uid(10),
      assignedAgentId: uid(1),
      unreadCount: 4,
      customerId: uid(100),
    });
    expect(result.meta).toEqual({ total: 51, page: 2, size: 25, totalPages: 3 });
    expect(repo.unreadConversationIds).not.toHaveBeenCalled();
  });

  it("loads unread ids only for the unread filter", async () => {
    repo.unreadConversationIds.mockResolvedValue([uid(10)]);
    repo.listInbox.mockResolvedValue({ items: [], total: 0 });
    await service.list(agent, { filter: "unread", page: 1, size: 25 });
    expect(repo.unreadConversationIds).toHaveBeenCalledWith(uid(1));
  });
});

describe("assigned agent profile", () => {
  it("adds name and avatar from Backend 1 to the inbox and detail, in one batched lookup", async () => {
    repo.listInbox.mockResolvedValue({ items: [row(), row({ id: uid(11) })], total: 2 });
    const result = await service.list(agent, { filter: "all", page: 1, size: 25 });
    expect(result.items[0]?.assignedAgent).toEqual({ id: uid(1), name: "Sarah Chen", avatarUrl: null });
    expect(directory.getAgents).toHaveBeenCalledTimes(1);
    expect(directory.getAgents).toHaveBeenCalledWith([uid(1)]);
    repo.findForAccess.mockResolvedValue(row());
    expect((await service.get(agent, uid(10))).assignedAgent?.name).toBe("Sarah Chen");
  });

  it("does not call Backend 1 when nobody is assigned, and still loads when it is down", async () => {
    repo.listInbox.mockResolvedValue({
      items: [row({ assignedAgentId: null, handoffStatus: "NEEDS_HUMAN" })],
      total: 1,
    });
    expect((await service.list(agent, { filter: "all", page: 1, size: 25 })).items[0]?.assignedAgent).toBeNull();
    expect(directory.getAgents).not.toHaveBeenCalled();

    directory.getAgents.mockRejectedValue(new Error("backend 1 down"));
    repo.listInbox.mockResolvedValue({ items: [row()], total: 1 });
    const item = (await service.list(agent, { filter: "all", page: 1, size: 25 })).items[0];
    expect(item).toMatchObject({ assignedAgentId: uid(1), assignedAgent: null });
  });

  it("includes the profile in realtime snapshots", async () => {
    repo.findForEvent.mockResolvedValue({ conversation: row(), viewerIds: [uid(4)] });
    const snapshot = await service.snapshot(uid(10));
    expect(snapshot?.conversation.assignedAgent?.name).toBe("Sarah Chen");
    expect(snapshot?.audience).toEqual({
      handoffStatus: "ASSIGNED",
      assignedAgentId: uid(1),
      viewerIds: [uid(4)],
      customerId: uid(100),
    });
    expect(snapshot?.conversation).not.toHaveProperty("unreadCount");
  });
});

describe("requireVisible", () => {
  it("returns the state for visible conversations and 404s hidden ones", async () => {
    repo.findForAccess.mockResolvedValue(row());
    await expect(service.requireVisible(agent, uid(10))).resolves.toMatchObject({ id: uid(10), customerId: uid(100) });
    await expect(service.requireVisible(other, uid(10))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("visibleSummaries", () => {
  it("returns only the conversations the caller may see, with their own unread counts", async () => {
    const mine = row({ id: uid(10) });
    const theirs = row({ id: uid(11), assignedAgentId: uid(2) });
    repo.findManyForAccess.mockResolvedValue([mine, theirs]);
    repo.unreadCounts.mockResolvedValue(new Map([[uid(10), 3]]));
    const result = await service.visibleSummaries(agent, [uid(10), uid(11), uid(10), uid(12)]);
    expect([...result.keys()]).toEqual([uid(10)]);
    expect(result.get(uid(10))?.unreadCount).toBe(3);
    expect(repo.findManyForAccess).toHaveBeenCalledWith([uid(10), uid(11), uid(12)], uid(1));
    expect(repo.unreadCounts).toHaveBeenCalledWith(uid(1), [uid(10)]);
  });

  it("lets a viewer see a conversation owned by someone else and skips the query for no ids", async () => {
    repo.findManyForAccess.mockResolvedValue([
      row({ id: uid(11), assignedAgentId: uid(2), conversationAssignments: [{ assignmentType: "VIEWER" }] }),
    ]);
    expect((await service.visibleSummaries(agent, [uid(11)])).has(uid(11))).toBe(true);
    repo.findManyForAccess.mockClear();
    expect((await service.visibleSummaries(agent, [])).size).toBe(0);
    expect(repo.findManyForAccess).not.toHaveBeenCalled();
  });
});

describe("get", () => {
  it("includes the caller's permissions", async () => {
    repo.findForAccess.mockResolvedValue(row());
    const detail = await service.get(agent, uid(10));
    expect(detail.permissions.canSendMessage).toBe(true);
    expect(detail.lastSequenceNumber).toBe("3");
  });

  it("hides missing and inaccessible conversations the same way", async () => {
    repo.findForAccess.mockResolvedValue(null);
    await expect(service.get(agent, uid(10))).rejects.toBeInstanceOf(NotFoundError);
    repo.findForAccess.mockResolvedValue(row());
    await expect(service.get(other, uid(10))).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.get(supervisor, uid(10))).resolves.toBeDefined();
  });

  it("lets a viewer open another agent's conversation", async () => {
    repo.findForAccess.mockResolvedValue(row({ conversationAssignments: [{ assignmentType: "VIEWER" }] }));
    await expect(service.get(other, uid(10))).resolves.toBeDefined();
  });
});

describe("create", () => {
  const input = { customerId: uid(100), applicationId: uid(7), priority: "MEDIUM" as const };

  it("creates a queued human conversation with a customer participant", async () => {
    repo.findByApplication.mockResolvedValue(null);
    repo.create.mockResolvedValue(row());
    repo.findForAccess.mockResolvedValue(row({ handoffStatus: "NEEDS_HUMAN", assignedAgentId: null }));
    const result = await service.create(agent, input);
    expect(identities.ensureCustomer).toHaveBeenCalledWith(input.customerId);
    expect(result.created).toBe(true);
    expect(repo.lockCustomer).toHaveBeenCalledWith(uid(100));
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByType: "AGENT",
        createdById: uid(1),
        handoffStatus: "NEEDS_HUMAN",
        conversationMode: "HUMAN",
      }),
    );
    expect(repo.addCustomerParticipant).toHaveBeenCalledWith(uid(10), uid(100));
    expect(realtime.conversationEvent).toHaveBeenCalledWith(uid(10), "created");
  });

  it("notifies online AVAILABLE agents, except the one who opened it", async () => {
    repo.findByApplication.mockResolvedValue(null);
    repo.create.mockResolvedValue(row());
    repo.findForAccess.mockResolvedValue(row({ handoffStatus: "NEEDS_HUMAN", assignedAgentId: null }));
    availableAgents.availableAgentIds.mockResolvedValue([uid(1), uid(2), uid(3)]);
    await service.create(agent, { ...input, customerName: "Maya Chen" });
    expect(notifications.notifyAgent).toHaveBeenCalledTimes(2);
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: uid(2),
        type: "NEW_CONVERSATION",
        conversationId: uid(10),
        body: "Maya Chen is waiting for an agent",
      }),
    );
    expect(notifications.notifyAgent).not.toHaveBeenCalledWith(expect.objectContaining({ agentId: uid(1) }));
  });

  it("returns the existing open conversation for the application instead of duplicating", async () => {
    repo.findByApplication.mockResolvedValue(row());
    repo.findForAccess.mockResolvedValue(row());
    const result = await service.create(agent, input);
    expect(result.created).toBe(false);
    expect(repo.create).not.toHaveBeenCalled();
    expect(realtime.conversationEvent).not.toHaveBeenCalled(); // nothing changed
    expect(notifications.notifyAgent).not.toHaveBeenCalled();
  });

  it("rejects an application that belongs to another customer", async () => {
    repo.findByApplication.mockResolvedValue(row({ customerId: uid(555) }));
    await expect(service.create(agent, input)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("changePriority", () => {
  beforeEach(() => {
    repo.findForAccess.mockResolvedValue(row());
    repo.transitionPriority.mockResolvedValue(true);
  });

  it("changes the priority, records from and to, and announces it", async () => {
    await service.changePriority(agent, uid(10), "HIGH");
    expect(repo.transitionPriority).toHaveBeenCalledWith(uid(10), "MEDIUM", "HIGH");
    expect(repo.addActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: "PRIORITY_CHANGED",
        actorId: uid(1),
        metadata: { from: "MEDIUM", to: "HIGH" },
      }),
    );
    expect(realtime.conversationEvent).toHaveBeenCalledWith(uid(10), "priority_changed", {
      from: "MEDIUM",
      to: "HIGH",
    });
  });

  it("does nothing when the priority is already that value", async () => {
    await service.changePriority(agent, uid(10), "MEDIUM");
    expect(repo.transitionPriority).not.toHaveBeenCalled();
    expect(repo.addActivity).not.toHaveBeenCalled();
    expect(realtime.conversationEvent).not.toHaveBeenCalled();
  });

  it("allows the owner, a supervisor, and anyone on an unowned conversation, but not another agent", async () => {
    await expect(service.changePriority(supervisor, uid(10), "LOW")).resolves.toBeTruthy();
    repo.findForAccess.mockResolvedValue(row({ handoffStatus: "NEEDS_HUMAN", assignedAgentId: null }));
    await expect(service.changePriority(other, uid(10), "LOW")).resolves.toBeTruthy();
    repo.findForAccess.mockResolvedValue(row({ conversationAssignments: [{ assignmentType: "VIEWER" }] }));
    await expect(service.changePriority(other, uid(10), "LOW")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("answers 409 and writes nothing when another change won", async () => {
    repo.transitionPriority.mockResolvedValue(false);
    await expect(service.changePriority(agent, uid(10), "HIGH")).rejects.toBeInstanceOf(ConflictError);
    expect(repo.addActivity).not.toHaveBeenCalled();
    expect(realtime.conversationEvent).not.toHaveBeenCalled();
  });
});

describe("changeStatus", () => {
  it("resolves as owner, releases the agent and records the activity", async () => {
    repo.findForAccess.mockResolvedValue(row());
    await service.changeStatus(agent, uid(10), "RESOLVED");
    expect(repo.transitionStatus).toHaveBeenCalledWith(
      uid(10),
      "OPEN",
      expect.objectContaining({ status: "RESOLVED", handoffStatus: "NONE", assignedAgentId: null }),
    );
    expect(repo.releaseOwner).toHaveBeenCalledWith(uid(10), uid(1), uid(1));
    expect(systemMessages.post).toHaveBeenCalledWith(
      uid(10),
      `Agent ${uid(1)} resolved the conversation`,
      expect.objectContaining({ to: "RESOLVED" }),
    );
    expect(repo.addActivity).toHaveBeenCalledWith(
      expect.objectContaining({ activityType: "STATUS_CHANGED", metadata: { from: "OPEN", to: "RESOLVED" } }),
    );
  });

  it("denies resolving a conversation the caller does not own", async () => {
    repo.findForAccess.mockResolvedValue(row({ handoffStatus: "NEEDS_HUMAN", assignedAgentId: null }));
    await expect(service.changeStatus(agent, uid(10), "RESOLVED")).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.transitionStatus).not.toHaveBeenCalled();
  });

  it("lets a supervisor close and any viewer reopen; reopening queues an unowned chat", async () => {
    repo.findForAccess.mockResolvedValue(row({ status: "RESOLVED", handoffStatus: "NONE", assignedAgentId: null }));
    await service.changeStatus(other, uid(10), "OPEN");
    expect(repo.transitionStatus).toHaveBeenCalledWith(
      uid(10),
      "RESOLVED",
      expect.objectContaining({ status: "OPEN", resolvedAt: null, closedAt: null, handoffStatus: "NEEDS_HUMAN" }),
    );
    expect(repo.releaseOwner).not.toHaveBeenCalled();
    await service.changeStatus(supervisor, uid(10), "CLOSED");
  });

  it("rejects no-op transitions and lost races", async () => {
    repo.findForAccess.mockResolvedValue(row());
    await expect(service.changeStatus(agent, uid(10), "OPEN")).rejects.toBeInstanceOf(ConflictError);
    repo.transitionStatus.mockResolvedValue(false);
    await expect(service.changeStatus(agent, uid(10), "RESOLVED")).rejects.toBeInstanceOf(ConflictError);
    expect(repo.addActivity).not.toHaveBeenCalled();
  });
});

describe("archive / restore", () => {
  it("archives as owner and records the activity", async () => {
    repo.findForAccess.mockResolvedValue(row());
    await service.archive(agent, uid(10));
    expect(repo.setArchived).toHaveBeenCalledWith(uid(10), true);
    expect(repo.addActivity).toHaveBeenCalledWith(expect.objectContaining({ activityType: "ARCHIVED" }));
  });

  it("denies a non-owner, rejects double-archive, and restores", async () => {
    repo.findForAccess.mockResolvedValue(row());
    await expect(service.archive(supervisorLike(), uid(10))).resolves.toBeDefined();
    await expect(service.archive(other, uid(10))).rejects.toBeInstanceOf(NotFoundError); // cannot even see it
    repo.findForAccess.mockResolvedValue(row({ isArchived: true }));
    await expect(service.archive(agent, uid(10))).rejects.toBeInstanceOf(ConflictError);
    await service.restore(agent, uid(10));
    expect(repo.addActivity).toHaveBeenLastCalledWith(expect.objectContaining({ activityType: "RESTORED" }));
  });
});

describe("activities", () => {
  it("checks access before listing", async () => {
    repo.findForAccess.mockResolvedValue(null);
    await expect(service.activities(agent, uid(10), { page: 1, size: 25 })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.listActivities).not.toHaveBeenCalled();
  });
});

function supervisorLike() {
  return supervisor;
}

describe("joinForCustomer", () => {
  const customer = uid(100);

  beforeEach(() => {
    repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
    repo.findByApplication.mockResolvedValue(null);
    repo.findOpenForCustomer.mockResolvedValue(null);
    repo.create.mockResolvedValue(row({ id: uid(11), assignedAgentId: null, handoffStatus: "NEEDS_HUMAN" }));
    repo.findForAccess.mockResolvedValue(row({ id: uid(11), assignedAgentId: null }));
    availableAgents.availableAgentIds.mockResolvedValue([uid(1)]);
    realtime.conversationEvent.mockResolvedValue(undefined);
    notifications.notifyAgent.mockResolvedValue(true);
  });

  it("creates a customer-owned conversation that waits for a human, and tells the available agents", async () => {
    const result = await service.joinForCustomer(customer, { applicationId: uid(200), subject: "Loan" });
    expect(result.created).toBe(true);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: customer,
        applicationId: uid(200),
        createdByType: "CUSTOMER",
        createdById: customer,
        conversationMode: "HUMAN",
        handoffStatus: "NEEDS_HUMAN",
      }),
    );
    expect(repo.addCustomerParticipant).toHaveBeenCalledWith(uid(11), customer);
    expect(notifications.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: uid(1), type: "NEW_CONVERSATION" }),
    );
  });

  it("returns the customer-safe shape: no agent id, priority or tags", async () => {
    const { conversation } = await service.joinForCustomer(customer, {});
    expect(conversation).toEqual({
      id: uid(11),
      applicationId: null,
      subject: null,
      status: "OPEN",
      agentAssigned: false,
      lastMessageAt: now.toISOString(),
      lastMessagePreview: "hi",
      lastSequenceNumber: "3",
      createdAt: now.toISOString(),
    });
  });

  it("joins the existing conversation of the application instead of creating another", async () => {
    repo.findByApplication.mockResolvedValue(row({ id: uid(12), customerId: customer }));
    repo.findForAccess.mockResolvedValue(row({ id: uid(12), customerId: customer }));
    const result = await service.joinForCustomer(customer, { applicationId: uid(200) });
    expect(result).toMatchObject({ created: false, conversation: { id: uid(12), agentAssigned: true } });
    expect(repo.create).not.toHaveBeenCalled();
    expect(notifications.notifyAgent).not.toHaveBeenCalled();
  });

  it("without an application, reuses the latest open conversation", async () => {
    repo.findOpenForCustomer.mockResolvedValue(row({ id: uid(13), customerId: customer }));
    repo.findForAccess.mockResolvedValue(row({ id: uid(13), customerId: customer }));
    expect((await service.joinForCustomer(customer, {})).created).toBe(false);
    expect(repo.findOpenForCustomer).toHaveBeenCalledWith(customer);
  });

  it("does not reveal that an application belongs to another customer", async () => {
    repo.findByApplication.mockResolvedValue(row({ customerId: uid(999) }));
    await expect(service.joinForCustomer(customer, { applicationId: uid(200) })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("getForCustomer", () => {
  it("is 404 for a conversation that belongs to someone else", async () => {
    repo.findForAccess.mockResolvedValue(row({ customerId: uid(999) }));
    await expect(service.getForCustomer(uid(100), uid(10))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("listForCustomer", () => {
  it("returns the customer-safe shape with page meta", async () => {
    repo.listForCustomer.mockResolvedValue({ items: [row({ assignedAgentId: null })], total: 1 });
    const { items, meta } = await service.listForCustomer(uid(100), { page: 1, size: 25 });
    expect(repo.listForCustomer).toHaveBeenCalledWith(uid(100), { page: 1, size: 25 });
    expect(items[0]).toMatchObject({ id: uid(10), agentAssigned: false, lastSequenceNumber: "3" });
    expect(items[0]).not.toHaveProperty("assignedAgentId");
    expect(items[0]).not.toHaveProperty("priority");
    expect(meta).toMatchObject({ total: 1, page: 1, size: 25 });
  });
});
