import {
  companyPropertyFilterSchema,
  COMPANY_PROPERTY_FILTER_MAX,
  COMPANY_PROPERTY_KEY,
  type CompanyPropertyFilter,
  type CompanySort,
  type CompanySortDir,
} from '@crm/contracts';
import { z } from 'zod';

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
  /** Conditions on company properties (BL-196), all of which must hold. */
  props: CompanyPropertyFilter[];
  sort: CompanySort;
  /** The property a `property` sort orders by. */
  sortKey: string;
  /** Empty means the order's own default (newest first for `created`, A to Z for the others). */
  sortDir: CompanySortDir | '';
}

export const DEFAULT_FILTERS: CompanyFilters = {
  q: '',
  owner: '',
  industry: '',
  openDeals: false,
  props: [],
  sort: 'created',
  sortKey: '',
  sortDir: '',
};

interface SearchLike {
  get(name: string): string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `props` of an address: a JSON array of conditions; anything that is not one is no conditions. */
export function parseProps(raw: string | null): CompanyPropertyFilter[] {
  if (!raw) return [];
  try {
    const parsed = z
      .array(companyPropertyFilterSchema)
      .max(COMPANY_PROPERTY_FILTER_MAX)
      .safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Reads the state from the address; unknown or malformed values fall back to the defaults instead of failing. */
export function parseFilters(search: SearchLike): CompanyFilters {
  const owner = search.get('owner') ?? '';
  const sort = search.get('sort');
  const sortKey = search.get('sortKey') ?? '';
  const dir = search.get('dir');
  const byProperty = sort === 'property' && COMPANY_PROPERTY_KEY.test(sortKey);
  return {
    q: (search.get('q') ?? '').slice(0, 100),
    owner: owner === 'none' || UUID.test(owner) ? owner : '',
    industry: (search.get('industry') ?? '').slice(0, 100),
    openDeals: search.get('openDeals') === '1',
    props: parseProps(search.get('props')),
    sort: byProperty ? 'property' : sort === 'name' ? 'name' : 'created',
    sortKey: byProperty ? sortKey : '',
    sortDir: dir === 'asc' || dir === 'desc' ? dir : '',
  };
}

/** The query string for an address (`?q=acme&sort=name`), empty when everything is the default. */
export function filtersToSearch(f: CompanyFilters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.owner) p.set('owner', f.owner);
  if (f.industry) p.set('industry', f.industry);
  if (f.openDeals) p.set('openDeals', '1');
  if (f.props.length > 0) p.set('props', JSON.stringify(f.props));
  if (f.sort !== DEFAULT_FILTERS.sort) p.set('sort', f.sort);
  if (f.sort === 'property' && f.sortKey) p.set('sortKey', f.sortKey);
  if (f.sortDir) p.set('dir', f.sortDir);
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
    props: f.props.length > 0 ? JSON.stringify(f.props) : undefined,
  };
}

export const listQuery = (f: CompanyFilters) => ({
  ...statsQuery(f),
  sort: f.sort,
  sortKey: f.sort === 'property' ? f.sortKey || undefined : undefined,
  sortDir: f.sortDir || undefined,
});

/** True when something narrows the list, so the empty state can say "no match" instead of "no companies yet". */
export const hasActiveFilter = (f: CompanyFilters): boolean =>
  f.q.trim() !== '' ||
  f.owner !== '' ||
  f.industry.trim() !== '' ||
  f.openDeals ||
  f.props.length > 0;

/** The select value of the order: `created`, `name` or `property:<key>`. */
export const sortValue = (f: Pick<CompanyFilters, 'sort' | 'sortKey'>): string =>
  f.sort === 'property' ? `property:${f.sortKey}` : f.sort;

/** The other way round: a select value to the filter fields it sets. */
export function sortFromValue(value: string): Pick<CompanyFilters, 'sort' | 'sortKey' | 'sortDir'> {
  if (value.startsWith('property:')) {
    const key = value.slice('property:'.length);
    if (COMPANY_PROPERTY_KEY.test(key)) return { sort: 'property', sortKey: key, sortDir: '' };
  }
  return { sort: value === 'name' ? 'name' : 'created', sortKey: '', sortDir: '' };
}
