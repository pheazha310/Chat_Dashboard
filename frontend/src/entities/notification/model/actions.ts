import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/shared/api/rest";
import { useSessionStore } from "@/shared/api/session";
import { isMockTransport } from "@/shared/api/ws";
import { useNotificationStore } from "./store";

const store = () => useNotificationStore.getState();

/** Loads the latest page and the unread total. The mock transport has no REST backend and keeps nothing. */
export async function loadNotifications(): Promise<void> {
  if (isMockTransport) return;
  try {
    const { items, unreadCount } = await listNotifications(useSessionStore.getState().userId ?? "");
    store().setAll(items, unreadCount);
  } catch {
    // The bell keeps what it has; the next sync loads again.
  }
}

/** Optimistic: the badge drops at once, and the server's view is restored if the request fails. */
export async function readNotification(id: string): Promise<void> {
  if (store().items.find((item) => item.id === id)?.read !== false) return;
  store().markRead(id);
  if (isMockTransport) return;
  try {
    await markNotificationRead(id);
  } catch {
    await loadNotifications();
  }
}

export async function readAllNotifications(): Promise<void> {
  if (store().unreadCount === 0) return;
  store().markAllRead();
  if (isMockTransport) return;
  try {
    await markAllNotificationsRead();
  } catch {
    await loadNotifications();
  }
}
