const COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#059669", "#0891b2", "#4f46e5", "#65a30d"];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** A deterministic initials avatar as a data URI, for people the backend sends no picture for. */
export function avatarFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  const color = COLORS[hash % COLORS.length];
  const text = initials(name).replace(/[<>&"]/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="32" fill="${color}"/>` +
    `<text x="32" y="40" font-family="Inter,Arial,sans-serif" font-size="24" font-weight="600" fill="#fff" text-anchor="middle">${text}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
