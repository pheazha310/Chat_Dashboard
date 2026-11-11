import { create } from "zustand";
import type { NotificationDto } from "@/shared/api/ws";

type NotificationState = {
  /** Newest first. Only the latest page: `unreadCount` is the server's total and can be larger. */
  items: NotificationDto[];
  unreadCount: number;
  setAll: (items: NotificationDto[], unreadCount: number) => void;
  add: (notification: NotificationDto) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** Another session of this agent read one notification (or all, with `id` null); the server sends the new total. */
  applyRead: (id: string | null, unreadCount: number) => void;
};

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  unreadCount: 0,
  setAll: (items, unreadCount) => set({ items, unreadCount }),
  add: (notification) =>
    set((state) =>
      state.items.some((item) => item.id === notification.id)
        ? state
        : {
            items: [notification, ...state.items],
            unreadCount: state.unreadCount + (notification.read ? 0 : 1),
          },
    ),
  markRead: (id) =>
    set((state) => {
      const target = state.items.find((item) => item.id === id);
      if (!target || target.read) return state;
      return {
        items: state.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    }),
  markAllRead: () => set((state) => ({ items: state.items.map((item) => ({ ...item, read: true })), unreadCount: 0 })),
  applyRead: (id, unreadCount) =>
    set((state) => ({
      items: state.items.map((item) => (id === null || item.id === id ? { ...item, read: true } : item)),
      unreadCount,
    })),
}));
