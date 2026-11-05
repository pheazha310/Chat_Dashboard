import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { NotFoundError, ServiceUnavailableError } from "@shared/errors/AppError.js";
import type { CustomerProfile } from "@shared/ports/directory.js";
import type { CustomerRepository } from "../customer.repository.js";
import { CustomerService, redactCustomer } from "../customer.service.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const profile: CustomerProfile = {
  id: "100",
  name: "Maya Chen",
  avatarUrl: null,
  blacklisted: false,
  email: "maya@example.test",
  phone: "+855 12 345 678",
  nationalId: "ID-1",
  occupation: "Teacher",
  salary: "800",
};
const agent: AuthContext = { userId: 1n, role: "AGENT" };
const other: AuthContext = { userId: 2n, role: "AGENT" };
const supervisor: AuthContext = { userId: 9n, role: "SUPERVISOR" };
const owned = { assignedAgentId: 1n };

describe("redactCustomer", () => {
  it("shows the owner contact details but not sensitive data", () => {
    const dto = redactCustomer(profile, agent, owned, "test");
    expect(dto).toMatchObject({ name: "Maya Chen", email: "maya@example.test", phone: "+855 12 345 678" });
    expect(dto).toMatchObject({ nationalId: null, occupation: null, salary: null });
    expect(dto.restricted).toEqual(["nationalId", "occupation", "salary"]);
  });

  it("shows another agent only the basic profile", () => {
    const dto = redactCustomer(profile, other, owned, "test");
    expect(dto).toMatchObject({ name: "Maya Chen", blacklisted: false, email: null, phone: null, nationalId: null });
    expect(dto.restricted).toEqual(["email", "phone", "nationalId", "occupation", "salary"]);
  });

  it("shows supervisors everything", () => {
    const dto = redactCustomer(profile, supervisor, owned, "test");
    expect(dto).toMatchObject({ email: "maya@example.test", nationalId: "ID-1", salary: "800" });
    expect(dto.restricted).toEqual([]);
  });

  it("does not mutate the Backend 1 profile", () => {
    redactCustomer(profile, other, owned, "test");
    expect(profile.email).toBe("maya@example.test");
  });
});

describe("CustomerService", () => {
  const repo = { participants: vi.fn() };
  const directory = { source: "test", getCustomer: vi.fn(), getAgents: vi.fn() };
  const access = { requireVisible: vi.fn() };
  const conversations = { list: vi.fn() };
  const service = new CustomerService(fromPartial<CustomerRepository>(repo), directory, access, conversations);

  beforeEach(() => {
    vi.resetAllMocks();
    access.requireVisible.mockResolvedValue({ id: 10n, customerId: 100n, assignedAgentId: 1n });
    directory.getCustomer.mockResolvedValue(profile);
    directory.getAgents.mockResolvedValue([{ id: "1", name: "Sarah Chen", avatarUrl: null }]);
  });

  it("checks access first, then returns the redacted profile with its source", async () => {
    const dto = await service.customer(other, 10n);
    expect(access.requireVisible).toHaveBeenCalledWith(other, 10n);
    expect(dto).toMatchObject({ name: "Maya Chen", email: null, source: "test" });
  });

  it("never calls Backend 1 for a conversation the caller cannot see", async () => {
    access.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.customer(other, 10n)).rejects.toBeInstanceOf(NotFoundError);
    expect(directory.getCustomer).not.toHaveBeenCalled();
  });

  it("404s for an internal conversation or an unknown customer, 503s when Backend 1 is down", async () => {
    access.requireVisible.mockResolvedValue({ id: 10n, customerId: null, assignedAgentId: null });
    await expect(service.customer(agent, 10n)).rejects.toBeInstanceOf(NotFoundError);
    access.requireVisible.mockResolvedValue({ id: 10n, customerId: 100n, assignedAgentId: 1n });
    directory.getCustomer.mockResolvedValue(null);
    await expect(service.customer(agent, 10n)).rejects.toBeInstanceOf(NotFoundError);
    directory.getCustomer.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(service.customer(agent, 10n)).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("lists the customer's other conversations through the same visibility rules", async () => {
    conversations.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, size: 25, totalPages: 1 } });
    await service.otherConversations(agent, 10n, { page: 1, size: 25 });
    expect(conversations.list).toHaveBeenCalledWith(agent, {
      page: 1,
      size: 25,
      filter: "all",
      customerId: 100n,
      excludeId: 10n,
    });
  });

  it("names participants from Backend 1 and leaves the AI assistant unnamed", async () => {
    const at = new Date("2026-01-01T00:00:00Z");
    repo.participants.mockResolvedValue([
      { participantType: "AGENT", participantId: 1n, participantRole: "OWNER", joinedAt: at, leftAt: null },
      { participantType: "CUSTOMER", participantId: 100n, participantRole: "MEMBER", joinedAt: at, leftAt: null },
      { participantType: "ASSISTANT", participantId: null, participantRole: "MEMBER", joinedAt: at, leftAt: at },
    ]);
    const result = await service.participants(agent, 10n);
    expect(result.map((p) => [p.participantType, p.participantId, p.profile?.name ?? null, p.leftAt !== null])).toEqual(
      [
        ["AGENT", "1", "Sarah Chen", false],
        ["CUSTOMER", "100", "Maya Chen", false],
        ["ASSISTANT", null, null, true],
      ],
    );
  });

  it("still lists participants, without names, when Backend 1 is down", async () => {
    repo.participants.mockResolvedValue([
      { participantType: "AGENT", participantId: 1n, participantRole: "OWNER", joinedAt: new Date(), leftAt: null },
    ]);
    directory.getAgents.mockRejectedValue(new Error("down"));
    expect((await service.participants(agent, 10n))[0]?.profile).toBeNull();
  });
});
