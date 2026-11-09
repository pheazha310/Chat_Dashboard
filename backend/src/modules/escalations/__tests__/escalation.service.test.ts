import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { EscalationRepository } from "../escalation.repository.js";
import { EscalationService } from "../escalation.service.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const repo = {
  inTransaction: vi.fn(),
  findById: vi.fn(),
  list: vi.fn(),
  openPending: vi.fn(),
  close: vi.fn(),
  addActivity: vi.fn(),
};
const access = { requireVisible: vi.fn() };
const realtime = fakeRealtime();
const service = new EscalationService(fromPartial<EscalationRepository>(repo), () => access, realtime);

const owner: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const at = new Date("2026-01-01T00:00:00Z");
const state = (patch = {}) => ({
  id: uid(10),
  status: "OPEN",
  handoffStatus: "ASSIGNED",
  assignedAgentId: uid(1),
  isArchived: false,
  customerId: uid(100),
  ...patch,
});
const row = (patch = {}) => ({
  id: uid(70),
  conversationId: uid(10),
  requestedBy: uid(1),
  reason: "customer is upset",
  status: "PENDING",
  resolvedBy: null,
  createdAt: at,
  resolvedAt: null,
  ...patch,
});

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
  repo.inTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(repo));
  access.requireVisible.mockResolvedValue(state());
  repo.openPending.mockResolvedValue(row());
});

describe("escalate", () => {
  it("records the escalation, a timeline entry, and tells everyone who can see the chat", async () => {
    const dto = await service.escalate(owner, uid(10), { reason: "customer is upset" });
    expect(repo.openPending).toHaveBeenCalledWith(uid(10), uid(1), "customer is upset");
    expect(repo.addActivity).toHaveBeenCalledWith(uid(10), uid(1), "Conversation escalated", {
      escalationId: uid(70),
      action: "requested",
    });
    expect(dto).toMatchObject({ status: "PENDING", requestedBy: uid(1), resolvedAt: null });
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "conversation.escalated", { escalation: dto });
  });

  it("allows only the owner of a conversation that is not closed", async () => {
    await expect(service.escalate(other, uid(10), {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.escalate(supervisor, uid(10), {})).rejects.toBeInstanceOf(ForbiddenError);
    access.requireVisible.mockResolvedValue(state({ status: "CLOSED" }));
    await expect(service.escalate(owner, uid(10), {})).rejects.toBeInstanceOf(ForbiddenError);
    access.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.escalate(owner, uid(10), {})).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.openPending).not.toHaveBeenCalled();
  });

  it("answers 409 and writes no timeline entry when one is already pending", async () => {
    repo.openPending.mockResolvedValue(null);
    await expect(service.escalate(owner, uid(10), {})).rejects.toBeInstanceOf(ConflictError);
    expect(repo.addActivity).not.toHaveBeenCalled();
    expect(realtime.messageEvent).not.toHaveBeenCalled();
  });

  it("stores a missing reason as null", async () => {
    await service.escalate(owner, uid(10), {});
    expect(repo.openPending).toHaveBeenCalledWith(uid(10), uid(1), null);
  });
});

describe("close", () => {
  beforeEach(() => {
    repo.findById.mockResolvedValue(row());
    repo.close.mockImplementation(async (_id: string, status: string, by: string) =>
      row({ status, resolvedBy: by, resolvedAt: at }),
    );
  });

  it("lets a supervisor resolve it and announces the new status", async () => {
    const dto = await service.close(supervisor, uid(70), { status: "RESOLVED" });
    expect(dto).toMatchObject({ status: "RESOLVED", resolvedBy: uid(9) });
    expect(repo.addActivity).toHaveBeenCalledWith(uid(10), uid(9), "Escalation resolved", {
      escalationId: uid(70),
      action: "resolved",
    });
    expect(realtime.messageEvent).toHaveBeenCalledWith(uid(10), "conversation.escalated", { escalation: dto });
  });

  it("does not let the requester or other agents resolve", async () => {
    await expect(service.close(owner, uid(70), { status: "RESOLVED" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.close(other, uid(70), { status: "RESOLVED" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.close).not.toHaveBeenCalled();
  });

  it("lets the requester or a supervisor cancel, but not another agent", async () => {
    await expect(service.close(owner, uid(70), { status: "CANCELLED" })).resolves.toMatchObject({
      status: "CANCELLED",
    });
    await expect(service.close(supervisor, uid(70), { status: "CANCELLED" })).resolves.toBeTruthy();
    await expect(service.close(other, uid(70), { status: "CANCELLED" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is 404 for unknown or hidden escalations and 409 once closed", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.close(supervisor, uid(70), { status: "RESOLVED" })).rejects.toBeInstanceOf(NotFoundError);
    repo.findById.mockResolvedValue(row());
    access.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.close(owner, uid(70), { status: "CANCELLED" })).rejects.toBeInstanceOf(NotFoundError);
    access.requireVisible.mockResolvedValue(state());
    repo.close.mockResolvedValue(null);
    await expect(service.close(supervisor, uid(70), { status: "RESOLVED" })).rejects.toBeInstanceOf(ConflictError);
    expect(repo.addActivity).not.toHaveBeenCalled();
  });
});

describe("list", () => {
  it("returns the history of a visible conversation only", async () => {
    repo.list.mockResolvedValue([row(), row({ id: uid(71), status: "RESOLVED" })]);
    expect((await service.list(owner, uid(10))).map((e) => e.status)).toEqual(["PENDING", "RESOLVED"]);
    access.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.list(other, uid(10))).rejects.toBeInstanceOf(NotFoundError);
  });
});
