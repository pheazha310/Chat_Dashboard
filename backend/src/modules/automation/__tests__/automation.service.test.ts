import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AutomationRepository } from "../automation.repository.js";
import { AutomationService } from "../automation.service.js";

const repo = {
  findAutoResponses: vi.fn(),
  saveAutoResponses: vi.fn(),
  listExamples: vi.fn(),
  createExample: vi.fn(),
  setApproval: vi.fn(),
};
const now = new Date("2030-01-01T00:00:00Z");
const service = new AutomationService(fromPartial<AutomationRepository>(repo), () => now);
const agent: AuthContext = { userId: uid(1), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const row = (patch = {}) => ({
  id: uid(30),
  customerMessage: "Can I change my date?",
  suggestedReply: "Yes, call us.",
  status: "PENDING",
  createdBy: uid(1),
  approvedBy: null,
  approvedAt: null,
  createdAt: now,
  ...patch,
});

beforeEach(() => vi.resetAllMocks());

describe("automatic replies", () => {
  it("anyone on staff can read them", async () => {
    repo.findAutoResponses.mockResolvedValue({ awayMessage: "away", firstResponse: null });
    expect(await service.getAutoResponses()).toEqual({ awayMessage: "away", firstResponse: null });
  });

  it("a supervisor saves both texts and gets them back", async () => {
    repo.findAutoResponses.mockResolvedValue({ awayMessage: "a", firstResponse: "f" });
    const result = await service.saveAutoResponses(supervisor, { awayMessage: "a", firstResponse: "f" });
    expect(repo.saveAutoResponses).toHaveBeenCalledWith(uid(9), { awayMessage: "a", firstResponse: "f" });
    expect(result).toEqual({ awayMessage: "a", firstResponse: "f" });
  });

  it("an agent cannot change them", async () => {
    await expect(service.saveAutoResponses(agent, { awayMessage: "a", firstResponse: "f" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repo.saveAutoResponses).not.toHaveBeenCalled();
  });
});

describe("training examples", () => {
  it("any agent proposes one; it starts pending", async () => {
    repo.createExample.mockResolvedValue(row());
    const created = await service.addExample(agent, { customerMessage: "Q", suggestedReply: "A" });
    expect(repo.createExample).toHaveBeenCalledWith(uid(1), { customerMessage: "Q", suggestedReply: "A" });
    expect(created).toMatchObject({
      status: "PENDING",
      approvedBy: null,
      approvedAt: null,
      createdAt: now.toISOString(),
    });
  });

  it("lists them as DTOs", async () => {
    repo.listExamples.mockResolvedValue([row()]);
    expect(await service.listExamples()).toEqual([expect.objectContaining({ id: uid(30), status: "PENDING" })]);
  });

  it("a supervisor approves one, recorded with who and when", async () => {
    repo.setApproval.mockResolvedValue(row({ status: "APPROVED", approvedBy: uid(9), approvedAt: now }));
    const result = await service.setApproval(supervisor, uid(30), true);
    expect(repo.setApproval).toHaveBeenCalledWith(uid(30), { by: uid(9), at: now });
    expect(result).toMatchObject({ status: "APPROVED", approvedBy: uid(9), approvedAt: now.toISOString() });
  });

  it("a supervisor takes an approval back", async () => {
    repo.setApproval.mockResolvedValue(row());
    await service.setApproval(supervisor, uid(30), false);
    expect(repo.setApproval).toHaveBeenCalledWith(uid(30), null);
  });

  it("an agent cannot approve", async () => {
    await expect(service.setApproval(agent, uid(30), true)).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.setApproval).not.toHaveBeenCalled();
  });

  it("approving something that does not exist is a 404", async () => {
    repo.setApproval.mockResolvedValue(null);
    await expect(service.setApproval(supervisor, uid(31), true)).rejects.toBeInstanceOf(NotFoundError);
  });
});
