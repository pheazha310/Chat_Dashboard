import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uid } from "../../../__tests__/support/ids.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { CannedResponse } from "../../../../prisma/generated/prisma/client.js";
import type { CannedResponseRepository } from "../canned-response.repository.js";
import { CannedResponseService } from "../canned-response.service.js";

const repo = { list: vi.fn(), findById: vi.fn(), create: vi.fn(), update: vi.fn(), findShortcutClash: vi.fn() };
const service = new CannedResponseService(fromPartial<CannedResponseRepository>(repo));

const agent: AuthContext = { userId: uid(1), role: "AGENT" };
const other: AuthContext = { userId: uid(2), role: "AGENT" };
const supervisor: AuthContext = { userId: uid(9), role: "SUPERVISOR" };
const at = new Date("2026-01-01T00:00:00Z");

const row = (patch: Partial<CannedResponse> = {}): CannedResponse =>
  fromPartial<CannedResponse>({
    id: uid(40),
    title: "Greeting",
    content: "Hello!",
    shortcut: "/hi",
    scope: "PERSONAL",
    teamId: null,
    createdBy: uid(1),
    isActive: true,
    createdAt: at,
    updatedAt: at,
    ...patch,
  });

beforeEach(() => {
  vi.resetAllMocks();
  repo.findShortcutClash.mockResolvedValue(null);
  repo.create.mockImplementation(async (d: object) => row(d as Partial<CannedResponse>));
  repo.update.mockImplementation(async (_id: string, d: object) => row(d as Partial<CannedResponse>));
});

describe("create", () => {
  it("creates a personal template by default, owned by the caller", async () => {
    const dto = await service.create(agent, {
      title: "Greeting",
      content: "Hello!",
      shortcut: "/hi",
      scope: "PERSONAL",
    });
    expect(repo.create).toHaveBeenCalledWith({
      title: "Greeting",
      content: "Hello!",
      shortcut: "/hi",
      scope: "PERSONAL",
      createdBy: uid(1),
    });
    expect(dto).toMatchObject({ scope: "PERSONAL", createdBy: uid(1), permissions: { canEdit: true } });
  });

  it("lets only supervisors create shared templates", async () => {
    await expect(service.create(agent, { title: "T", content: "C", scope: "SHARED" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repo.create).not.toHaveBeenCalled();
    await expect(service.create(supervisor, { title: "T", content: "C", scope: "SHARED" })).resolves.toMatchObject({
      scope: "SHARED",
    });
  });

  it("refuses a shortcut already used where the new template would be visible", async () => {
    repo.findShortcutClash.mockResolvedValue({ id: uid(41) });
    await expect(
      service.create(agent, { title: "T", content: "C", shortcut: "/hi", scope: "PERSONAL" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(repo.findShortcutClash).toHaveBeenCalledWith("PERSONAL", uid(1), "/hi", undefined);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("does not check shortcuts when there is none", async () => {
    await service.create(agent, { title: "T", content: "C", scope: "PERSONAL" });
    expect(repo.findShortcutClash).not.toHaveBeenCalled();
  });
});

describe("visibility", () => {
  it("hides someone else's personal template, even from a supervisor", async () => {
    repo.findById.mockResolvedValue(row());
    await expect(service.get(agent, uid(40))).resolves.toBeTruthy();
    await expect(service.get(other, uid(40))).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.get(supervisor, uid(40))).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.update(supervisor, uid(40), { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.deactivate(other, uid(40))).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("shows active shared templates to everyone, inactive ones only to supervisors", async () => {
    repo.findById.mockResolvedValue(row({ scope: "SHARED", createdBy: uid(9) }));
    await expect(service.get(other, uid(40))).resolves.toMatchObject({ permissions: { canEdit: false } });
    repo.findById.mockResolvedValue(row({ scope: "SHARED", createdBy: uid(9), isActive: false }));
    await expect(service.get(other, uid(40))).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.get(supervisor, uid(40))).resolves.toMatchObject({ isActive: false });
  });

  it("does not expose team templates", async () => {
    repo.findById.mockResolvedValue(row({ scope: "TEAM", teamId: uid(5) }));
    await expect(service.get(agent, uid(40))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reports each template's edit right in lists", async () => {
    repo.list.mockResolvedValue({ items: [row(), row({ id: uid(41), scope: "SHARED", createdBy: uid(9) })], total: 2 });
    const { items, meta } = await service.list(agent, { page: 1, size: 50, includeInactive: false });
    expect(items.map((t) => t.permissions.canEdit)).toEqual([true, false]);
    expect(meta.total).toBe(2);
  });
});

describe("update", () => {
  it("lets the owner edit a personal template and a supervisor edit a shared one, but not an agent", async () => {
    repo.findById.mockResolvedValue(row());
    await expect(service.update(agent, uid(40), { title: "New" })).resolves.toBeTruthy();
    expect(repo.update).toHaveBeenCalledWith(uid(40), { title: "New" });
    repo.findById.mockResolvedValue(row({ scope: "SHARED", createdBy: uid(9) }));
    await expect(service.update(supervisor, uid(40), { content: "New" })).resolves.toBeTruthy();
    await expect(service.update(other, uid(40), { content: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("checks the shortcut only when it changes or the template comes back", async () => {
    repo.findById.mockResolvedValue(row());
    await service.update(agent, uid(40), { title: "same shortcut" });
    await service.update(agent, uid(40), { shortcut: "/hi" });
    expect(repo.findShortcutClash).not.toHaveBeenCalled();
    await service.update(agent, uid(40), { shortcut: "/new" });
    expect(repo.findShortcutClash).toHaveBeenCalledWith("PERSONAL", uid(1), "/new", uid(40));
    repo.findShortcutClash.mockResolvedValue({ id: uid(41) });
    await expect(service.update(agent, uid(40), { shortcut: "/taken" })).rejects.toBeInstanceOf(ConflictError);

    repo.findShortcutClash.mockClear();
    repo.findById.mockResolvedValue(row({ isActive: false }));
    repo.findShortcutClash.mockResolvedValue({ id: uid(41) });
    await expect(service.update(agent, uid(40), { isActive: true })).rejects.toBeInstanceOf(ConflictError); // its shortcut was taken meanwhile
  });

  it("does not check the shortcut of a template being deactivated or stripped of its shortcut", async () => {
    repo.findById.mockResolvedValue(row());
    await service.update(agent, uid(40), { isActive: false, shortcut: "/changed" });
    await service.update(agent, uid(40), { shortcut: null });
    expect(repo.findShortcutClash).not.toHaveBeenCalled();
  });
});

describe("deactivate", () => {
  it("deactivates once and is quiet when repeated", async () => {
    repo.findById.mockResolvedValue(row());
    await expect(service.deactivate(agent, uid(40))).resolves.toBeTruthy();
    expect(repo.update).toHaveBeenCalledWith(uid(40), { isActive: false });
    repo.update.mockClear();
    repo.findById.mockResolvedValue(row({ isActive: false }));
    await expect(service.deactivate(agent, uid(40))).resolves.toMatchObject({ isActive: false });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("is limited to those who may edit", async () => {
    repo.findById.mockResolvedValue(row({ scope: "SHARED", createdBy: uid(9) }));
    await expect(service.deactivate(agent, uid(40))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.deactivate(supervisor, uid(40))).resolves.toBeTruthy();
  });
});
