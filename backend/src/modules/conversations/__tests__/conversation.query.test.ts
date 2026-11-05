import { describe, expect, it } from "vitest";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { buildInboxWhere, visibilityWhere } from "../conversation.query.js";
import { listQuery } from "../conversation.schema.js";

const agent: AuthContext = { userId: 1n, role: "AGENT" };
const supervisor: AuthContext = { userId: 9n, role: "SUPERVISOR" };
const q = (input: Record<string, string> = {}) => listQuery.parse(input);

describe("visibilityWhere", () => {
  it("is unrestricted for supervisors and restricted for agents", () => {
    expect(visibilityWhere(supervisor)).toEqual({});
    expect(JSON.stringify(visibilityWhere(agent), (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toContain(
      '"handoffStatus":{"not":"ASSIGNED"}',
    );
  });
});

describe("buildInboxWhere", () => {
  const json = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const and = (where: ReturnType<typeof buildInboxWhere>) => where.AND as Record<string, unknown>[];

  it("always applies visibility, and hides archived chats except in the archived filter", () => {
    expect(and(buildInboxWhere(agent, q()))).toContainEqual({ isArchived: false });
    expect(and(buildInboxWhere(agent, q({ filter: "archived" })))).toContainEqual({ isArchived: true });
    expect(and(buildInboxWhere(agent, q()))[0]).toEqual(visibilityWhere(agent));
  });

  it("maps the Mine, Unassigned and Unread filters", () => {
    expect(and(buildInboxWhere(agent, q({ filter: "mine" })))).toContainEqual({ assignedAgentId: 1n });
    expect(and(buildInboxWhere(agent, q({ filter: "unassigned" })))).toContainEqual({ handoffStatus: "NEEDS_HUMAN" });
    expect(and(buildInboxWhere(agent, q({ filter: "unread" }), [5n, 6n]))).toContainEqual({ id: { in: [5n, 6n] } });
  });

  it("combines status, priority, tag and search", () => {
    const where = and(buildInboxWhere(agent, q({ status: "OPEN", priority: "HIGH", tag: "3", q: "123" })));
    expect(where).toContainEqual({ status: "OPEN" });
    expect(where).toContainEqual({ priority: "HIGH" });
    expect(where).toContainEqual({ conversationTags: { some: { tagId: 3n } } });
    const search = where.find((w) => json(w).includes("customerName"));
    expect((search?.OR as unknown[]).length).toBe(3); // name, identifier and numeric customer id
  });

  it("does not search by customer id for non-numeric text", () => {
    const search = and(buildInboxWhere(agent, q({ q: "maya" }))).find((w) => json(w).includes("customerName"));
    expect((search?.OR as unknown[]).length).toBe(2);
  });
});
