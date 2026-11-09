/** Desktop notifications through the browser API. Silent no-ops where the API or permission is missing. */

const supported = () => typeof Notification !== "undefined";

/** Must be called from a user gesture (a click), or browsers ignore it. */
export function requestBrowserNotificationPermission() {
  if (supported() && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
}

/** Shown only while the dashboard is in the background; in the foreground the in-app toast is enough. */
export function showBrowserNotification(title: string, body: string) {
  if (!supported() || Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && !document.hidden) return;
  try {
    new Notification(title, { body });
  } catch {
    /* Some browsers only allow notifications from a service worker. */
  }
}
