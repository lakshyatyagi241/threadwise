import {
  MARKET_APP_KINDS,
  MARKET_APP_STATUSES,
  type MarketAppKind,
  type MarketAppStatus,
  type MarketOperatorApp,
  type MarketOperatorCategory,
} from '@crm/contracts';

export const KIND_FILTERS = ['all', ...MARKET_APP_KINDS] as const;
export type KindFilter = (typeof KIND_FILTERS)[number];

export const STATUS_FILTERS = ['all', ...MARKET_APP_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** The API's `pricing` query: `paid` is the priced listings, `free` the rest. */
export const PRICING_FILTERS = ['all', 'free', 'paid'] as const;
export type PricingFilter = (typeof PRICING_FILTERS)[number];

/** `kind:slug`: a category slug is only unique inside its kind (`automation` exists for mini apps and for integrations). */
export const categoryKey = (kind: MarketAppKind, slug: string): string => `${kind}:${slug}`;
export const ALL_CATEGORIES = 'all';

export interface CatalogueFilters {
  status: StatusFilter;
  kind: KindFilter;
  pricing: PricingFilter;
  /** `kind:slug` of a category, or `all`. The API has no category query, so this filters the rows already loaded. */
  category: string;
  search: string;
}

export const NO_FILTERS: CatalogueFilters = {
  status: 'all',
  kind: 'all',
  pricing: 'all',
  category: ALL_CATEGORIES,
  search: '',
};

/**
 * What goes on the wire: the API filters status, kind, pricing and name search itself (so a filter finds rows on pages not loaded yet).
 * The category is not a query parameter and stays on the client.
 */
export function listQuery(f: CatalogueFilters): {
  status?: MarketAppStatus;
  kind?: MarketAppKind;
  pricing?: 'free' | 'paid';
  q?: string;
} {
  const q = f.search.trim();
  return {
    ...(f.status !== 'all' ? { status: f.status } : {}),
    ...(f.kind !== 'all' ? { kind: f.kind } : {}),
    ...(f.pricing !== 'all' ? { pricing: f.pricing } : {}),
    ...(q ? { q: q.slice(0, 80) } : {}),
  };
}

/** The category filter over loaded rows (the other filters are the API's). */
export function filterByCategory(
  apps: readonly MarketOperatorApp[],
  category: string,
): MarketOperatorApp[] {
  if (category === ALL_CATEGORIES) return [...apps];
  return apps.filter((a) => categoryKey(a.kind, a.category.slug) === category);
}

/** Counts of the loaded rows by status: the KPI tiles, labelled "loaded" because more pages may exist. */
export function statusCounts(
  apps: readonly MarketOperatorApp[],
): Record<MarketAppStatus, number> & { all: number } {
  const counts = { all: apps.length, draft: 0, in_review: 0, published: 0, hidden: 0, killed: 0 };
  for (const a of apps) counts[a.status] += 1;
  return counts;
}

export interface CategoryOption {
  value: string;
  kind: MarketAppKind;
  name: string;
}

/** The category select's options, grouped by kind then ordered the way the operator ordered them. */
export function categoryOptions(
  categories: readonly Pick<MarketOperatorCategory, 'kind' | 'slug' | 'name' | 'sortOrder'>[],
): CategoryOption[] {
  return [...categories]
    .sort(
      (a, b) =>
        MARKET_APP_KINDS.indexOf(a.kind) - MARKET_APP_KINDS.indexOf(b.kind) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name),
    )
    .map((c) => ({ value: categoryKey(c.kind, c.slug), kind: c.kind, name: c.name }));
}
