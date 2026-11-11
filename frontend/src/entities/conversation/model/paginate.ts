/** One page of `list` (1-based). An out-of-range page is clamped so the list never shows empty by mistake. */
export function paginate<T>(list: T[], page: number, size: number) {
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(Math.max(1, page), totalPages);
  return { items: list.slice((current - 1) * size, current * size), page: current, totalPages };
}
