import { API_LIBRARY_PAGE_SIZES } from '@crm/contracts';

/** Rows per page offered by the footer; the API accepts exactly these. */
export const PAGE_SIZES = API_LIBRARY_PAGE_SIZES;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

/** `?page=` as a page number: a whole number from 1 up, anything else is the first page. */
export function parsePage(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** `?limit=` as one of the offered sizes, else the default. */
export function parseLimit(value: string | null | undefined): PageSize {
  const n = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : DEFAULT_PAGE_SIZE;
}

export type NumberedPage<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/** What the list routes answer: the contract's envelope, where the totals sit in `page` and are repeated at the top level. */
interface Envelope<T> {
  data: T[];
  page: { page?: number; pageSize?: number; total?: number; totalPages?: number };
  total?: number;
  pageSize?: number;
  totalPages?: number;
}

/**
 * The totals of a numbered answer in one flat shape. Looks at the top level first, then at `page`; a missing number falls back to
 * what was asked for (the API always sends them when `page` was in the request, so this is only a guard against an older server).
 */
export function normalizePage<T>(
  res: Envelope<T>,
  asked: { page: number; limit: number },
): NumberedPage<T> {
  const total = res.total ?? res.page.total ?? res.data.length;
  const pageSize = res.pageSize ?? res.page.pageSize ?? asked.limit;
  return {
    data: res.data,
    total,
    page: res.page.page ?? asked.page,
    pageSize,
    totalPages: res.totalPages ?? res.page.totalPages ?? Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type PageSlot = number | 'gap';

export function clampPage(page: number, pages: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, pages));
}

/**
 * The numbered buttons: a sliding run of `size` pages around the current one, the first and last page when the run does not reach
 * them, and a `gap` where pages are skipped (a single skipped page is shown instead). Few pages are all listed:
 * `[1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]`.
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

/** "11-20 of 53": the rows on the current page. Zeros for an empty list. */
export function rangeOf(page: number, pageSize: number, rowsOnPage: number, total: number) {
  if (rowsOnPage <= 0 || total <= 0) return { from: 0, to: 0, total };
  const from = (page - 1) * pageSize + 1;
  return { from, to: from + rowsOnPage - 1, total };
}

/** The page to show instead when the asked one is past the last (a filter or a delete shrank the list); null when it is fine. */
export function pageToFallBackTo(page: number, totalPages: number): number | null {
  const last = Math.max(1, totalPages);
  return page > last ? last : null;
}

/** The API stops counting log rows here (page mode on a table that can hold millions), so a total at the cap reads "100,000+". */
export const COUNT_CAP = 100_000;

export function formatTotal(total: number, locale = 'en'): string {
  const n = new Intl.NumberFormat(locale).format(total);
  return total >= COUNT_CAP ? `${n}+` : n;
}
