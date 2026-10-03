import type { CompanySort } from '@crm/contracts';

/**
 * The Companies list's state, kept in the address so a view can be shared and the back button works. Reference had one box
 * (`?q=`); the rest narrow the same list. Everything here is pure.
 */
export const SORTS = ['created', 'name'] as const;

export interface CompanyFilters {
  q: string;
  /** A member id, `none` for companies nobody owns, or empty for everyone. */
  owner: string;
  industry: string;
  /** Only companies with at least one open deal (Reference's "With open deals" tile). */
  openDeals: boolean;
  sort: CompanySort;
}

export const DEFAULT_FILTERS: CompanyFilters = {
  q: '',
  owner: '',
  industry: '',
  openDeals: false,
  sort: 'created',
};

interface SearchLike {
  get(name: string): string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the state from the address; unknown or malformed values fall back to the defaults instead of failing. */
export function parseFilters(search: SearchLike): CompanyFilters {
  const owner = search.get('owner') ?? '';
  const sort = search.get('sort');
  return {
    q: (search.get('q') ?? '').slice(0, 100),
    owner: owner === 'none' || UUID.test(owner) ? owner : '',
    industry: (search.get('industry') ?? '').slice(0, 100),
    openDeals: search.get('openDeals') === '1',
    sort: sort === 'name' ? 'name' : 'created',
  };
}

/** The query string for an address (`?q=acme&sort=name`), empty when everything is the default. */
export function filtersToSearch(f: CompanyFilters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.owner) p.set('owner', f.owner);
  if (f.industry) p.set('industry', f.industry);
  if (f.openDeals) p.set('openDeals', '1');
  if (f.sort !== DEFAULT_FILTERS.sort) p.set('sort', f.sort);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The filter half of `GET /companies`, also the whole of `GET /companies/stats` (the tiles follow the search box). */
export function statsQuery(f: CompanyFilters) {
  return {
    q: f.q.trim() || undefined,
    ownerId: f.owner && f.owner !== 'none' ? f.owner : undefined,
    unassigned: f.owner === 'none' ? true : undefined,
    industry: f.industry.trim() || undefined,
    hasOpenDeals: f.openDeals ? true : undefined,
  };
}

export const listQuery = (f: CompanyFilters) => ({ ...statsQuery(f), sort: f.sort });

/** True when something narrows the list, so the empty state can say "no match" instead of "no companies yet". */
export const hasActiveFilter = (f: CompanyFilters): boolean =>
  f.q.trim() !== '' || f.owner !== '' || f.industry.trim() !== '' || f.openDeals;
