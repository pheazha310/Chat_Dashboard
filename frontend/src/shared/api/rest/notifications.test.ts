import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ apiRequest: request }));

import { listNotifications, markAllNotificationsRead, markNotificationRead } from "./notifications";

const backend = (id: string, read = false) => ({
  id,
  type: "NEW_CONVERSATION",
  title: "New",
  body: "Maya waits",
  conversationId: "12",
  read,
  createdAt: "2026-01-01T09:00:00.000Z",
});

beforeEach(() => request.mockReset());

describe("listNotifications", () => {
  it("requests the newest page and maps rows with the unread total", async () => {
    request.mockResolvedValue({ data: [backend("1")], meta: { unreadCount: 4 } });

    const result = await listNotifications("3");

    expect(request).toHaveBeenCalledWith("/notifications", { query: { size: 30 } });
    expect(result.unreadCount).toBe(4);
    expect(result.items).toEqual([
      {
        id: "1",
        agentId: "3",
        type: "new-conversation",
        text: "New: Maya waits",
        conversationId: "12",
        read: false,
        createdAt: "2026-01-01T09:00:00.000Z",
      },
    ]);
  });
});

describe("markNotificationRead", () => {
  it("patches the one notification", async () => {
    request.mockResolvedValue({ data: {}, meta: undefined });
    await markNotificationRead("7");
    expect(request).toHaveBeenCalledWith("/notifications/7/read", { method: "PATCH" });
  });
});

describe("markAllNotificationsRead", () => {
  it("posts read-all", async () => {
    request.mockResolvedValue({ data: { updated: 2, unreadCount: 0 }, meta: undefined });
    await markAllNotificationsRead();
    expect(request).toHaveBeenCalledWith("/notifications/read-all", { method: "POST" });
  });
});
