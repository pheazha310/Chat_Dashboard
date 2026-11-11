import { useEffect, useRef, useState } from "react";
import { readAllNotifications, readNotification, useNotificationStore } from "@/entities/notification";
import { assets } from "@/shared/config";
import { formatListTime } from "@/shared/lib/format-time";
import { AssetIcon } from "@/shared/ui";

const TYPE_META: Record<string, { icon: string; label: string }> = {
  "new-conversation": { icon: "💬", label: "New conversation" },
  handoff: { icon: "🤝", label: "Handoff" },
  callback: { icon: "⏰", label: "Callback reminder" },
  mention: { icon: "@", label: "Mention" },
  system: { icon: "ℹ️", label: "System" },
};

const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const UUID = /\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Splits "Title: detail" and makes raw ISO times and UUIDs in the server text readable. */
function describe(type: string, text: string) {
  const label = TYPE_META[type]?.label ?? "Notification";
  const readable = text
    .replace(ISO_TIME, (iso) =>
      new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    )
    .replace(UUID, "#$1");
  const prefix = readable.indexOf(": ");
  return prefix > 0 && prefix < 40
    ? { title: readable.slice(0, prefix), detail: readable.slice(prefix + 2), label }
    : { title: label, detail: readable, label };
}

/** The bell in the top bar: an unread badge, and a list of the latest notifications to read or clear. */
export default function NotificationBell({
  onOpenConversation,
}: {
  /** Called with the conversation of a clicked notification; the parent widget decides how to show it. */
  onOpenConversation?: (conversationId: string) => void;
}) {
  const items = useNotificationStore((state) => state.items);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="notification-menu" ref={ref}>
      <button
        className="circle-action notification"
        onClick={() => setOpen((value) => !value)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <AssetIcon src={assets.icons.bell} />
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && (
        <div className="more-menu notification-popover" role="region" aria-label="Notifications">
          <div className="notification-header">
            <strong>
              Notifications
              {unreadCount > 0 && <span className="notification-count">{unreadCount} new</span>}
            </strong>
            <button disabled={unreadCount === 0} onClick={() => void readAllNotifications()}>
              Mark all read
            </button>
          </div>
          {items.length === 0 ? (
            <p className="notification-empty">You're all caught up</p>
          ) : (
            <ul className="notification-list">
              {items.map((item) => {
                const { title, detail } = describe(item.type, item.text);
                return (
                  <li key={item.id}>
                    <button
                      className={item.read ? "notification-item" : "notification-item unread"}
                      onClick={() => {
                        void readNotification(item.id);
                        if (item.conversationId && onOpenConversation) {
                          onOpenConversation(item.conversationId);
                          setOpen(false);
                        }
                      }}
                    >
                      <span className="notification-icon" aria-hidden="true">
                        {TYPE_META[item.type]?.icon ?? "🔔"}
                      </span>
                      <span className="notification-body">
                        <span className="notification-title">{title}</span>
                        {detail && <span className="notification-text">{detail}</span>}
                        <small>{formatListTime(item.createdAt)}</small>
                      </span>
                      {!item.read && <span className="notification-dot" role="img" aria-label="Unread" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
