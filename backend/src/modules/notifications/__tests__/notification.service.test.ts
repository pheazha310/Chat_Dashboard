import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../__tests__/support/realtime.js";
import { NotFoundError } from "@shared/errors/AppError.js";
import type { NotificationRepository } from "../notification.repository.js";
import { NotificationService } from "../notification.service.js";
import { uid } from "../../../__tests__/support/ids.js";

const repo = {
  findPreferences: vi.fn(),
  upsertPreferences: vi.fn(),
  isMuted: vi.fn(),
  setMuted: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  countUnread: vi.fn(),
  findOwned: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
};
const access = { requireVisible: vi.fn() };
const realtime = fakeRealtime();
const service = new NotificationService(fromPartial<NotificationRepository>(repo), realtime, () => access);
const base = { agentId: uid(1), title: "t", conversationId: uid(5) };

beforeEach(() => {
  vi.resetAllMocks();
  repo.findPreferences.mockResolvedValue(null);
  repo.isMuted.mockResolvedValue(false);
  repo.create.mockResolvedValue({
    id: uid(7),
    notificationType: "ASSIGNED",
    title: "t",
    body: null,
    conversationId: uid(5),
    messageId: null,
    readAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  for (const mock of Object.values(realtime)) mock.mockResolvedValue(undefined);
});

describe("NotificationService.notifyAgent", () => {
  it("stores by default when the agent has no preferences row", async () => {
    await expect(service.notifyAgent({ ...base, type: "ASSIGNED" })).resolves.toBe(true);
    expect(repo.create).toHaveBeenCalledOnce();
    expect(realtime.notification).toHaveBeenCalledWith(
      uid(1),
      expect.objectContaining({ id: uid(7), read: false, conversationId: uid(5) }),
    );
  });

  it("honours the per-type preference switches", async () => {
    repo.findPreferences.mockResolvedValue({ assignmentEnabled: false, transferEnabled: true });
    await expect(service.notifyAgent({ ...base, type: "ASSIGNED" })).resolves.toBe(false);
    expect(realtime.notification).not.toHaveBeenCalled(); // switched off: nothing stored, nothing pushed
    await expect(service.notifyAgent({ ...base, type: "TRANSFERRED" })).resolves.toBe(true);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it("skips new-message notifications for muted conversations only", async () => {
    repo.isMuted.mockResolvedValue(true);
    await expect(service.notifyAgent({ ...base, type: "NEW_MESSAGE" })).resolves.toBe(false);
    await expect(service.notifyAgent({ ...base, type: "ASSIGNED" })).resolves.toBe(true);
  });
});

const row = (patch: Record<string, unknown> = {}) => ({
  id: uid(7),
  notificationType: "ASSIGNED",
  title: "t",
  body: null,
  conversationId: uid(5),
  messageId: null,
  readAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...patch,
});
const agent = { userId: uid(1), role: "AGENT" } as const;

describe("reading notifications", () => {
  it("lists newest first with the caller's total unread in the meta", async () => {
    repo.list.mockResolvedValue({ items: [row(), row({ id: uid(6), readAt: new Date() })], total: 12 });
    repo.countUnread.mockResolvedValue(9);
    const result = await service.list(agent, { page: 2, size: 10, unread: false });
    expect(repo.list).toHaveBeenCalledWith(uid(1), false, { skip: 10, take: 10 });
    expect(result.items.map((n) => [n.id, n.read])).toEqual([
      [uid(7), false],
      [uid(6), true],
    ]);
    expect(result.meta).toEqual({ total: 12, page: 2, size: 10, totalPages: 2, unreadCount: 9 });
  });

  it("marks one read, idempotently, and tells the agent's other sessions the new count", async () => {
    repo.findOwned.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ readAt: new Date() }));
    repo.countUnread.mockResolvedValue(3);
    const result = await service.markRead(agent, uid(7));
    expect(repo.markRead).toHaveBeenCalledWith(uid(7), uid(1));
    expect(result.read).toBe(true);
    expect(realtime.notificationRead).toHaveBeenCalledWith(uid(1), { notificationId: uid(7), unreadCount: 3 });
  });

  it("treats someone else's notification as missing", async () => {
    repo.findOwned.mockResolvedValue(null);
    await expect(service.markRead(agent, uid(7))).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.markRead).not.toHaveBeenCalled();
    expect(realtime.notificationRead).not.toHaveBeenCalled();
  });

  it("marks everything read", async () => {
    repo.markAllRead.mockResolvedValue(4);
    repo.countUnread.mockResolvedValue(0);
    expect(await service.markAllRead(agent)).toEqual({ updated: 4, unreadCount: 0 });
    expect(realtime.notificationRead).toHaveBeenCalledWith(uid(1), { notificationId: null, unreadCount: 0 });
  });
});

describe("muting and preferences", () => {
  it("mutes only a conversation the caller can see", async () => {
    access.requireVisible.mockResolvedValue({ id: uid(5) });
    expect(await service.setMuted(agent, uid(5), true)).toEqual({ conversationId: uid(5), muted: true });
    expect(repo.setMuted).toHaveBeenCalledWith(uid(5), uid(1), true);
    access.requireVisible.mockRejectedValue(new NotFoundError());
    await expect(service.setMuted(agent, uid(6), true)).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.setMuted).toHaveBeenCalledTimes(1);
  });

  it("defaults every switch to on until the agent changes one", async () => {
    repo.findPreferences.mockResolvedValue(null);
    expect(await service.getPreferences(agent)).toEqual({
      newMessage: true,
      assignment: true,
      transfer: true,
      mention: true,
      sound: true,
      browser: true,
    });
    repo.upsertPreferences.mockResolvedValue({ newMessageEnabled: false, browserEnabled: false });
    const updated = await service.updatePreferences(agent, { newMessage: false, browser: false });
    expect(repo.upsertPreferences).toHaveBeenCalledWith(uid(1), { newMessage: false, browser: false });
    expect(updated).toMatchObject({ newMessage: false, browser: false, assignment: true });
  });
});
