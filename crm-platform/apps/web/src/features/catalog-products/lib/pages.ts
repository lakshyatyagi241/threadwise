/** Numbered pages over the cursor API: the page model and the products list state in the address. */

export const totalPages = (total: number, size: number): number =>
  Math.max(1, Math.ceil(total / size));

/** Pages shown around the current one: first, last, and two either side, with a gap marker between. */
export function pageWindow(page: number, pages: number): Array<number | 'gap'> {
  const keep = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2]);
  const out: Array<number | 'gap'> = [];
  let last = 0;
  for (const p of [...keep].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)) {
    if (p - last > 1) out.push('gap');
    out.push(p);
    last = p;
  }
  return out;
}

export interface ProductsListState {
  q: string;
  /** 1-based. */
  page: number;
}

export const DEFAULT_PRODUCTS_STATE: ProductsListState = { q: '', page: 1 };

export function parseProductsState(search: URLSearchParams): ProductsListState {
  const page = Number(search.get('page'));
  return {
    q: search.get('q')?.trim() ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Only what differs from the default goes into the address. */
export function productsStateToSearch(state: ProductsListState): string {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.page > 1) p.set('page', String(state.page));
  const out = p.toString();
  return out ? `?${out}` : '';
}

export const REVIEW_TABS = ['pending', 'approved', 'rejected'] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

/** An unknown value falls back to pending (as WaDesk and the API do). */
export function parseReviewTab(raw: string | null): ReviewTab {
  return (REVIEW_TABS as readonly string[]).includes(raw ?? '') ? (raw as ReviewTab) : 'pending';
}

export function reviewsStateToSearch(tab: ReviewTab, page: number): string {
  const p = new URLSearchParams();
  if (tab !== 'pending') p.set('status', tab);
  if (page > 1) p.set('page', String(page));
  const out = p.toString();
  return out ? `?${out}` : '';
}
