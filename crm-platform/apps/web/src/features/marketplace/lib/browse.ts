import {
  MARKET_APP_KINDS,
  MARKET_APP_SORTS,
  MARKET_SLUG_RE,
  type MarketAppKind,
  type MarketCategory,
} from '@crm/contracts';
import { mktRoutes } from './routes';

/** Browse: the two tabs, the filters kept in the address (`?category=&q=&installed=true&sort=`) and the category list of a tab. */

export type BrowseSort = (typeof MARKET_APP_SORTS)[number];
export const DEFAULT_SORT: BrowseSort = 'featured';
export const SORT_OPTIONS = MARKET_APP_SORTS;
export const PAGE_SIZE = 24;
export const SEARCH_MAX = 80;

export interface BrowseTab {
  kind: MarketAppKind;
  /** The route segment: `/marketplace/<segment>`. */
  segment: 'apps' | 'integrations';
  href: string;
}

export const BROWSE_TABS: readonly BrowseTab[] = [
  { kind: 'mini_app', segment: 'apps', href: mktRoutes.apps },
  { kind: 'integration', segment: 'integrations', href: mktRoutes.integrations },
];

/** The kinds the tabs stand for, from the contract: a third kind there would fail this at build time. */
export const TAB_KINDS: readonly MarketAppKind[] = MARKET_APP_KINDS;

export function tabForKind(kind: MarketAppKind): BrowseTab {
  return BROWSE_TABS.find((t) => t.kind === kind) ?? BROWSE_TABS[0]!;
}

export function kindForSegment(segment: string): MarketAppKind | null {
  return BROWSE_TABS.find((t) => t.segment === segment)?.kind ?? null;
}

export interface BrowseFilters {
  category: string | null;
  q: string;
  installed: boolean;
  sort: BrowseSort;
}

export const NO_FILTERS: BrowseFilters = {
  category: null,
  q: '',
  installed: false,
  sort: DEFAULT_SORT,
};

interface ParamsLike {
  get(name: string): string | null;
}

const isSort = (v: string | null): v is BrowseSort =>
  v !== null && (MARKET_APP_SORTS as readonly string[]).includes(v);

/** Reads the address. A value the API would refuse (a malformed slug, an unknown sort) is dropped instead of sent. */
export function parseBrowseParams(params: ParamsLike): BrowseFilters {
  const category = params.get('category');
  const sort = params.get('sort');
  return {
    category: category && MARKET_SLUG_RE.test(category) ? category : null,
    q: (params.get('q') ?? '').trim().slice(0, SEARCH_MAX),
    installed: params.get('installed') === 'true',
    sort: isSort(sort) ? sort : DEFAULT_SORT,
  };
}

/** The address of a tab with filters; defaults are left out so the plain tab stays `/marketplace/apps`. */
export function browseHref(kind: MarketAppKind, filters: Partial<BrowseFilters> = {}): string {
  const p = new URLSearchParams();
  if (filters.category) p.set('category', filters.category);
  const q = filters.q?.trim();
  if (q) p.set('q', q.slice(0, SEARCH_MAX));
  if (filters.installed) p.set('installed', 'true');
  if (filters.sort && filters.sort !== DEFAULT_SORT) p.set('sort', filters.sort);
  const s = p.toString();
  return `${mktRoutes.browse(kind)}${s ? `?${s}` : ''}`;
}

/** Whether any filter narrows the list (sort alone does not): shelves are for the unfiltered view only. */
export function hasActiveFilter(f: BrowseFilters): boolean {
  return f.category !== null || f.q !== '' || f.installed;
}

export const showShelves = (f: BrowseFilters): boolean => !hasActiveFilter(f);

/** The query of `GET /marketplace/apps`. */
export function listQuery(kind: MarketAppKind, f: BrowseFilters) {
  return {
    kind,
    category: f.category ?? undefined,
    q: f.q || undefined,
    installed: f.installed ? true : undefined,
    sort: f.sort,
    limit: PAGE_SIZE,
  };
}

export interface CategoryItem {
  /** `null` is the "All" entry. */
  slug: string | null;
  name: string | null;
  count: number;
  selected: boolean;
  href: string;
}

/**
 * The category list of a tab: "All" first (the sum of the counts), then the categories in the API's order. A category in the
 * address that the list does not have is still reported as selected-nothing, so the page can say so instead of showing an
 * empty grid with no explanation.
 */
export function categoryItems(
  kind: MarketAppKind,
  categories: readonly Pick<MarketCategory, 'slug' | 'name' | 'appCount' | 'sortOrder'>[],
  filters: BrowseFilters,
): CategoryItem[] {
  const ordered = [...categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const rest = { q: filters.q, installed: filters.installed, sort: filters.sort };
  return [
    {
      slug: null,
      name: null,
      count: ordered.reduce((n, c) => n + c.appCount, 0),
      selected: filters.category === null,
      href: browseHref(kind, rest),
    },
    ...ordered.map((c) => ({
      slug: c.slug,
      name: c.name,
      count: c.appCount,
      selected: filters.category === c.slug,
      href: browseHref(kind, { ...rest, category: c.slug }),
    })),
  ];
}

export function knownCategory(
  categories: ReadonlyArray<Pick<MarketCategory, 'slug'>>,
  slug: string | null,
): boolean {
  return slug === null || categories.some((c) => c.slug === slug);
}

/** Which empty state to show for a list with no rows. */
export type EmptyReason = 'search' | 'category' | 'installed' | 'none';
export function emptyReason(f: BrowseFilters): EmptyReason {
  if (f.q) return 'search';
  if (f.installed) return 'installed';
  if (f.category) return 'category';
  return 'none';
}
