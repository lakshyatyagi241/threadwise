/**
 * Numbered pages over a cursor API. The API only says "here is the next cursor", so page N is reached by following
 * cursors from the nearest page already loaded (see `useContactsPage`); this file is the arithmetic around it.
 */

export type PageSlot = number | 'gap';

/** At least one page, even for an empty list, so the footer never shows "page 1 of 0". */
export function totalPages(total: number, limit: number): number {
  if (!Number.isFinite(total) || total <= 0 || limit <= 0) return 1;
  return Math.max(1, Math.ceil(total / limit));
}

export function clampPage(page: number, pages: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, pages));
}

/**
 * The numbered buttons: always the first and last page, the current one with `siblings` on each side, and a `gap`
 * where pages are skipped (never for a single skipped page, which is shown instead). `[1, 'gap', 4, 5, 6, 'gap', 20]`.
 */
export function pageWindow(current: number, pages: number, siblings = 1): PageSlot[] {
  if (pages <= 1) return [1];
  const keep = new Set<number>([1, pages]);
  for (let p = current - siblings; p <= current + siblings; p++) {
    if (p >= 1 && p <= pages) keep.add(p);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: PageSlot[] = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && p - prev > 2) out.push('gap');
    out.push(p);
  });
  return out;
}

/** "11-20 of 53": the range of rows on the current page. */
export function rangeLabel(page: number, limit: number, rowsOnPage: number, total: number) {
  if (rowsOnPage === 0) return { from: 0, to: 0, total };
  const from = (page - 1) * limit + 1;
  return { from, to: from + rowsOnPage - 1, total };
}
