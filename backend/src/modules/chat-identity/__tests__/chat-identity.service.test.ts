import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@shared/errors/AppError.js";
import type { ChatIdentityRepository } from "../chat-identity.repository.js";
import { ChatIdentityService } from "../chat-identity.service.js";
import { uid } from "../../../__tests__/support/ids.js";

const repo = { upsert: vi.fn(), ensure: vi.fn(), sync: vi.fn(), setStatus: vi.fn() };
const service = new ChatIdentityService(fromPartial<ChatIdentityRepository>(repo));

const row = (status: string, grants: Array<[string, string]> = []) => ({
  id: uid(900),
  status,
  role: { name: "X", rolePermissions: grants.map(([module, action]) => ({ permission: { module, action } })) },
});

beforeEach(() => {
  vi.resetAllMocks();
  repo.upsert.mockResolvedValue(row("ACTIVE"));
});

describe("resolve", () => {
  it("maps a customer token to a CUSTOMER chat user keyed by the user id", async () => {
    await expect(service.resolve({ userId: uid(100), role: "CUSTOMER" })).resolves.toMatchObject({
      chatUserId: uid(900),
    });
    expect(repo.upsert).toHaveBeenCalledWith("CUSTOMER", uid(100), "CUSTOMER");
  });

  it.each(["AGENT", "SUPERVISOR", "ADMIN"] as const)(
    "maps %s to a STAFF chat user and records the role",
    async (role) => {
      await service.resolve({ userId: uid(1), role });
      expect(repo.upsert).toHaveBeenCalledWith("STAFF", uid(1), role);
    },
  );

  it("returns the role's permissions as module.action names", async () => {
    repo.upsert.mockResolvedValue(
      row("ACTIVE", [
        ["tags", "delete"],
        ["conversations", "view_all"],
      ]),
    );
    const { permissions } = await service.resolve({ userId: uid(1), role: "AGENT" });
    expect([...permissions].sort()).toEqual(["conversations.view_all", "tags.delete"]);
  });

  it("refuses a disabled chat user", async () => {
    repo.upsert.mockResolvedValue(row("DISABLED"));
    await expect(service.resolve({ userId: uid(1), role: "AGENT" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("account changes", () => {
  it("creates a customer identity on demand, and syncs name and role by kind", async () => {
    await service.ensureCustomer(uid(5));
    expect(repo.ensure).toHaveBeenCalledWith("CUSTOMER", uid(5), "CUSTOMER");
    await service.sync({ id: uid(6), role: "SUPERVISOR", displayName: "Sophea" });
    expect(repo.sync).toHaveBeenCalledWith("STAFF", uid(6), "SUPERVISOR", "Sophea");
    await service.setStatus({ id: uid(7), role: "CUSTOMER" }, "DISABLED");
    expect(repo.setStatus).toHaveBeenCalledWith("CUSTOMER", uid(7), "CUSTOMER", "DISABLED");
  });
});
