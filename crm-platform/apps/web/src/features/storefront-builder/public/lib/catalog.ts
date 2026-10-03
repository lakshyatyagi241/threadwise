import type { PublicProduct } from '@crm/contracts';

/** Search, filter and sort over the loaded product cards (WD-STORE-031). */
export const SORT_MODES = ['featured', 'price-asc', 'price-desc', 'name-asc', 'name-desc'] as const;
export type SortMode = (typeof SORT_MODES)[number];

export interface FilterState {
  term: string;
  categories: string[];
  /** Price inputs are in major units and kept as typed; empty or not a number means no bound. */
  min: string;
  max: string;
  inStockOnly: boolean;
  saleOnly: boolean;
  sort: SortMode;
}

export const DEFAULT_FILTERS: FilterState = {
  term: '',
  categories: [],
  min: '',
  max: '',
  inStockOnly: true,
  saleOnly: false,
  sort: 'featured',
};

export const isSoldOut = (p: Pick<PublicProduct, 'stockQty'>): boolean =>
  p.stockQty !== null && p.stockQty <= 0;

export const isOnSale = (p: Pick<PublicProduct, 'comparePriceMinor' | 'priceMinor'>): boolean =>
  p.comparePriceMinor !== null && p.comparePriceMinor > p.priceMinor;

/** Percent off as the badge shows it. */
export const discountPercent = (
  p: Pick<PublicProduct, 'comparePriceMinor' | 'priceMinor'>,
): number =>
  p.comparePriceMinor && p.comparePriceMinor > p.priceMinor
    ? Math.round(((p.comparePriceMinor - p.priceMinor) / p.comparePriceMinor) * 100)
    : 0;

const bound = (raw: string): number | null => {
  const n = parseFloat(raw);
  return Number.isNaN(n) ? null : n * 100;
};

/** Multiple categories are OR, every other filter is AND. "Featured" is the server order, restored whenever it is picked. */
export function applyFilters(products: readonly PublicProduct[], f: FilterState): PublicProduct[] {
  const term = f.term.trim().toLowerCase();
  const min = bound(f.min);
  const max = bound(f.max);
  const shown = products.filter((p) => {
    if (term && !p.name.toLowerCase().includes(term)) return false;
    if (f.categories.length > 0 && !f.categories.includes(p.category ?? '')) return false;
    if (min !== null && p.priceMinor < min) return false;
    if (max !== null && p.priceMinor > max) return false;
    if (f.inStockOnly && isSoldOut(p)) return false;
    if (f.saleOnly && !isOnSale(p)) return false;
    return true;
  });
  if (f.sort === 'featured') return shown;
  const sorted = [...shown];
  switch (f.sort) {
    case 'price-asc':
      return sorted.sort((a, b) => a.priceMinor - b.priceMinor);
    case 'price-desc':
      return sorted.sort((a, b) => b.priceMinor - a.priceMinor);
    case 'name-asc':
      return sorted.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    default:
      return sorted.sort((a, b) => b.name.toLowerCase().localeCompare(a.name.toLowerCase()));
  }
}

/** Distinct non-empty categories, in order of first appearance, over everything loaded so far. */
export function categoriesOf(products: readonly PublicProduct[]): string[] {
  const seen = new Set<string>();
  for (const p of products) if (p.category) seen.add(p.category);
  return [...seen];
}

/** Cheapest and dearest price in whole major units, over everything loaded (the filter's "Range" hint). */
export function priceRange(products: readonly PublicProduct[]): { min: number; max: number } {
  if (products.length === 0) return { min: 0, max: 0 };
  const prices = products.map((p) => p.priceMinor);
  return { min: Math.round(Math.min(...prices) / 100), max: Math.round(Math.max(...prices) / 100) };
}

export const isSortMode = (v: string): v is SortMode =>
  (SORT_MODES as readonly string[]).includes(v);

/** Appends a fetched page, ignoring products already loaded. */
export function mergeProducts(
  current: readonly PublicProduct[],
  incoming: readonly PublicProduct[],
): PublicProduct[] {
  const have = new Set(current.map((p) => p.id));
  return [...current, ...incoming.filter((p) => !have.has(p.id))];
}
