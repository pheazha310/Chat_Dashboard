import { beforeEach, describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock("@/shared/api/rest", () => rest);
const ws = vi.hoisted(() => ({ mock: false }));
vi.mock("@/shared/api/ws", () => ({
  get isMockTransport() {
    return ws.mock;
  },
}));

import { useSessionStore } from "@/shared/api/session";
import type { NotificationDto } from "@/shared/api/ws";
import { loadNotifications, readAllNotifications, readNotification } from "./actions";
import { useNotificationStore } from "./store";

const make = (id: string, read = false): NotificationDto => ({
  id,
  agentId: "3",
  type: "system",
  text: `text ${id}`,
  read,
  createdAt: "2026-01-01T09:00:00.000Z",
});
const state = () => useNotificationStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  ws.mock = false;
  useSessionStore.setState({ userId: "3", role: "AGENT" });
  useNotificationStore.setState({ items: [], unreadCount: 0 });
});

describe("loadNotifications", () => {
  it("fills the store from the backend for the signed-in agent", async () => {
    rest.listNotifications.mockResolvedValue({ items: [make("1")], unreadCount: 7 });
    await loadNotifications();
    expect(rest.listNotifications).toHaveBeenCalledWith("3");
    expect(state().items).toHaveLength(1);
    expect(state().unreadCount).toBe(7);
  });

  it("does nothing with the mock transport, which has no REST backend", async () => {
    ws.mock = true;
    await loadNotifications();
    expect(rest.listNotifications).not.toHaveBeenCalled();
  });

  it("keeps what it has when the request fails", async () => {
    state().setAll([make("1")], 1);
    rest.listNotifications.mockRejectedValue(new Error("offline"));
    await loadNotifications();
    expect(state().items).toHaveLength(1);
  });
});

describe("readNotification", () => {
  it("marks it read at once and tells the backend", async () => {
    state().setAll([make("1")], 1);
    rest.markNotificationRead.mockResolvedValue(undefined);
    await readNotification("1");
    expect(state().unreadCount).toBe(0);
    expect(rest.markNotificationRead).toHaveBeenCalledWith("1");
  });

  it("restores the server's view when the request fails", async () => {
    state().setAll([make("1")], 1);
    rest.markNotificationRead.mockRejectedValue(new Error("offline"));
    rest.listNotifications.mockResolvedValue({ items: [make("1")], unreadCount: 1 });
    await readNotification("1");
    expect(state().unreadCount).toBe(1);
    expect(state().items[0]?.read).toBe(false);
  });

  it("does not call the backend for a notification that is already read", async () => {
    state().setAll([make("1", true)], 0);
    await readNotification("1");
    expect(rest.markNotificationRead).not.toHaveBeenCalled();
  });
});

describe("readAllNotifications", () => {
  it("marks everything read at once and tells the backend", async () => {
    state().setAll([make("1"), make("2")], 2);
    rest.markAllNotificationsRead.mockResolvedValue(undefined);
    await readAllNotifications();
    expect(state().unreadCount).toBe(0);
    expect(rest.markAllNotificationsRead).toHaveBeenCalled();
  });

  it("skips the request when nothing is unread", async () => {
    await readAllNotifications();
    expect(rest.markAllNotificationsRead).not.toHaveBeenCalled();
  });
});
