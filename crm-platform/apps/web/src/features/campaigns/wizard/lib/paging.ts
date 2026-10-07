/** Page numbers to show under a table: the first, the last, the current one and its neighbours, with `null` where pages are skipped. */
export function pageWindow(page: number, pages: number): Array<number | null> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const want = new Set([1, 2, pages - 1, pages, page - 1, page, page + 1]);
  const shown = [...want].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out: Array<number | null> = [];
  shown.forEach((p, i) => {
    if (i > 0 && p - shown[i - 1]! > 1) out.push(null);
    out.push(p);
  });
  return out;
}

export const pageCount = (total: number, perPage: number): number =>
  Math.max(1, Math.ceil(total / perPage));
