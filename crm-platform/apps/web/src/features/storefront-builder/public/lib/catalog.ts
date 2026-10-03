import type { PublicProduct } from '@crm/contracts';

/** Search, filter and sort over the loaded product cards (TW-STORE-031). */
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

/**
 * The card's "Sold out" state. Reference lists only products whose in-stock flag is on, so a listed product is never sold out on
 * the card or the product page; a stock of 0 is enforced when it is added to the cart instead (see the cart store).
 */
export const isSoldOut = (_p: Pick<PublicProduct, 'stockQty'>): boolean => false;

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

/** The products in the order a sort mode puts them (ties keep the incoming order). */
export function sortProducts(products: readonly PublicProduct[], mode: SortMode): PublicProduct[] {
  const sorted = [...products];
  switch (mode) {
    case 'price-asc':
      return sorted.sort((a, b) => a.priceMinor - b.priceMinor);
    case 'price-desc':
      return sorted.sort((a, b) => b.priceMinor - a.priceMinor);
    case 'name-asc':
      return sorted.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    case 'name-desc':
      return sorted.sort((a, b) => b.name.toLowerCase().localeCompare(a.name.toLowerCase()));
    default:
      return sorted;
  }
}

/** Puts `list` in the order of `previous` ids; products it does not know keep their place after the known ones. */
function orderLike(list: PublicProduct[], previous: readonly string[]): PublicProduct[] {
  const at = new Map(previous.map((id, i) => [id, i] as const));
  const known = list.filter((p) => at.has(p.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  return [...known, ...list.filter((p) => !at.has(p.id))];
}

/**
 * Multiple categories are OR, every other filter is AND.
 * QUIRK (Reference): picking "Featured" does not restore the server order, the cards stay where the last price or name sort left
 * them. `previousOrder` is the id order of that last sort; without it "Featured" is the server order.
 */
export function applyFilters(
  products: readonly PublicProduct[],
  f: FilterState,
  previousOrder?: readonly string[] | null,
): PublicProduct[] {
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
  if (f.sort === 'featured') return previousOrder ? orderLike(shown, previousOrder) : shown;
  return sortProducts(shown, f.sort);
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
