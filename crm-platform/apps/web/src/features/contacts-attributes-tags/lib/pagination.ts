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
 * The numbered buttons: a sliding run of `size` pages around the current one (1 2 3 4 5 at the start), the first and
 * last page when the run does not reach them, and a `gap` where pages are skipped (never for a single skipped page,
 * which is shown instead). Few pages are all listed. `[1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]`.
 */
export function pageWindow(current: number, pages: number, size = 5): PageSlot[] {
  if (pages <= 1) return [1];
  const run = Math.max(3, size);
  if (pages <= run + 2) return Array.from({ length: pages }, (_, i) => i + 1);
  const at = clampPage(current, pages);
  const start = Math.min(Math.max(1, at - Math.floor(run / 2)), pages - run + 1);
  const end = start + run - 1;
  const out: PageSlot[] = [];
  if (start > 1) {
    out.push(1);
    if (start === 3) out.push(2);
    else if (start > 3) out.push('gap');
  }
  for (let p = start; p <= end; p++) out.push(p);
  if (end < pages) {
    if (end === pages - 2) out.push(pages - 1);
    else if (end < pages - 2) out.push('gap');
    out.push(pages);
  }
  return out;
}

/**
 * How many pages ahead of the furthest page already loaded a click may jump. The API only has cursors (OFFSET is banned),
 * so page N is reached by fetching every page before it: a jump of ten pages is ten quick requests, a jump of six hundred
 * would be a minute of them. Numbers beyond this reach are not drawn as buttons (the footer says "of N" instead); they are
 * reached by stepping forward, which also loads and caches the pages in between.
 */
export const JUMP_REACH = 10;

/**
 * The slots of `pageWindow` with the pages that cannot be reached cheaply taken out. `known` is the highest page whose rows
 * are already loaded (the current page, or one the person has been past); every page up to `known + JUMP_REACH` is a
 * button. Going back is always cheap (those pages are cached or one request from the first), so only the forward end is cut:
 * a `gap` is kept only when a reachable page follows it, and the last page is kept only when it is itself in reach.
 */
export function reachableSlots(
  current: number,
  pages: number,
  known: number = current,
  size = 5,
): PageSlot[] {
  const limit = Math.max(current, known) + JUMP_REACH;
  const out: PageSlot[] = [];
  for (const slot of pageWindow(current, pages, size)) {
    if (slot === 'gap') {
      out.push(slot);
    } else if (slot <= limit) {
      out.push(slot);
    }
  }
  // A trailing gap leads nowhere when the page after it was cut.
  while (out.length > 0 && out[out.length - 1] === 'gap') out.pop();
  return out;
}

/** "11-20 of 53": the range of rows on the current page. */
export function rangeLabel(page: number, limit: number, rowsOnPage: number, total: number) {
  if (rowsOnPage === 0) return { from: 0, to: 0, total };
  const from = (page - 1) * limit + 1;
  return { from, to: from + rowsOnPage - 1, total };
}
