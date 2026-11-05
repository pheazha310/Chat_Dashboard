import { describe, expect, it } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { canView, permissionsFor, type PolicyInput } from "../conversation-access.js";

const agent: AuthContext = { userId: 1n, role: "AGENT" };
const other: AuthContext = { userId: 2n, role: "AGENT" };
const supervisor: AuthContext = { userId: 9n, role: "SUPERVISOR" };

const conv = (patch: Partial<PolicyInput> = {}): PolicyInput => ({
  status: "OPEN",
  handoffStatus: "NEEDS_HUMAN",
  assignedAgentId: null,
  isArchived: false,
  ...patch,
});
const owned = conv({ handoffStatus: "ASSIGNED", assignedAgentId: 1n });

describe("canView", () => {
  it("hides another agent's assigned chat unless supervisor or viewer", () => {
    expect(canView(other, owned, false)).toBe(false);
    expect(canView(other, owned, true)).toBe(true);
    expect(canView(supervisor, owned, false)).toBe(true);
    expect(canView(agent, owned, false)).toBe(true);
  });

  it("shows queue and AI-handled chats to every agent", () => {
    expect(canView(other, conv(), false)).toBe(true);
    expect(canView(other, conv({ handoffStatus: "NONE" }), false)).toBe(true);
  });
});

describe("permissionsFor", () => {
  it("lets any agent take over a waiting conversation, but only supervisors an AI or owned one", () => {
    expect(permissionsFor(agent, conv()).canTakeOver).toBe(true);
    expect(permissionsFor(agent, conv({ handoffStatus: "NONE" })).canTakeOver).toBe(false);
    expect(permissionsFor(supervisor, conv({ handoffStatus: "NONE" })).canTakeOver).toBe(true);
    expect(permissionsFor(other, owned).canTakeOver).toBe(false);
    expect(permissionsFor(supervisor, owned).canTakeOver).toBe(true);
    expect(permissionsFor(agent, owned).canTakeOver).toBe(false);
  });

  it("only the owner may send, and never on closed or archived chats", () => {
    expect(permissionsFor(agent, owned).canSendMessage).toBe(true);
    expect(permissionsFor(other, owned).canSendMessage).toBe(false);
    expect(permissionsFor(supervisor, owned).canSendMessage).toBe(false);
    expect(permissionsFor(agent, { ...owned, status: "CLOSED" }).canSendMessage).toBe(false);
    expect(permissionsFor(agent, { ...owned, isArchived: true }).canSendMessage).toBe(false);
  });

  it("limits resolve, close, transfer and assigning others to owner/supervisor", () => {
    const p = permissionsFor(agent, owned);
    expect([p.canResolve, p.canClose, p.canTransfer, p.canUnassign, p.canAssignOthers]).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    const q = permissionsFor(other, owned);
    expect([q.canResolve, q.canClose, q.canTransfer, q.canUnassign]).toEqual([false, false, false, false]);
    expect(permissionsFor(agent, conv()).canResolve).toBe(false);
    expect(permissionsFor(supervisor, conv()).canResolve).toBe(true);
  });

  it("allows reopen only when not open, and archive rules follow ownership", () => {
    expect(permissionsFor(agent, conv()).canReopen).toBe(false);
    expect(permissionsFor(agent, conv({ status: "RESOLVED" })).canReopen).toBe(true);
    expect(permissionsFor(agent, conv()).canArchive).toBe(true); // unassigned
    expect(permissionsFor(other, owned).canArchive).toBe(false);
    expect(permissionsFor(other, { ...owned, isArchived: true }).canRestore).toBe(false);
    expect(permissionsFor(agent, { ...owned, isArchived: true }).canRestore).toBe(true);
  });
});
