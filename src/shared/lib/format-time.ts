const clock = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

export const formatClock = (iso: string) => clock.format(new Date(iso));

/** "09:12 AM" for today, "Yesterday" for yesterday, otherwise a short date. */
export function formatListTime(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000,
  );
  if (days <= 0) return formatClock(iso);
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
