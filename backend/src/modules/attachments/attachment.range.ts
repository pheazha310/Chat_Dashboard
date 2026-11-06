/** A single byte range from a `Range` header, or why it cannot be served. */
export type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

/**
 * Parses `Range: bytes=start-end`, `bytes=start-` and `bytes=-suffix` for a file of `size` bytes. Returns null when
 * there is no (usable) range, so the whole file is sent. Several ranges are not supported and are ignored.
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return null;
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
