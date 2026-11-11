import { toNotification } from "@/shared/api/backend/mappers";
import type { BackendNotification } from "@/shared/api/backend/types";
import type { NotificationDto } from "@/shared/api/ws/protocol";
import { apiRequest } from "./client";

export type NotificationPage = { items: NotificationDto[]; unreadCount: number };

/** The newest notifications of the signed-in agent and their total unread count (docs/api-conversations.md). */
export async function listNotifications(agentId: string): Promise<NotificationPage> {
  const { data, meta } = await apiRequest<BackendNotification[], { unreadCount?: number }>("/notifications", {
    query: { size: 30 },
  });
  return { items: data.map((row) => toNotification(row, agentId)), unreadCount: meta?.unreadCount ?? 0 };
}

export const markNotificationRead = async (id: string) =>
  void (await apiRequest(`/notifications/${id}/read`, { method: "PATCH" }));

export const markAllNotificationsRead = async () =>
  void (await apiRequest("/notifications/read-all", { method: "POST" }));
