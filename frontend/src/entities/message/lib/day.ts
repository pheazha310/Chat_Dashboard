/** `YYYY-MM-DD` of a time in the agent's own timezone: which day divider a message falls under. */
export function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day divider text: "Today", "Yesterday", "Sat, Oct 3", or "Oct 3, 2025" for another year. */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return "Today";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return "Yesterday";
  return date.getFullYear() === now.getFullYear()
    ? date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
    : date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
