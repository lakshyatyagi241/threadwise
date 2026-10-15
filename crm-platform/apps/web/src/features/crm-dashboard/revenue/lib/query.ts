import {
  REVENUE_COMPARES,
  REVENUE_GROUPS,
  REVENUE_RANGES,
  type RequestRevenueExport,
  type RevenueCompare,
  type RevenueGroup,
  type RevenueRange,
} from '@crm/contracts';

/**
 * The revenue report's state lives in the address, so a view can be shared and the back button works:
 * `?range=30d&compare=lastYear&group=product&owner=<id>&currency=EUR`. Unknown or malformed values fall back to the defaults
 * instead of failing. Defaults are left out of the address.
 */
export interface RevenueFilters {
  range: RevenueRange;
  /** `YYYY-MM-DD`, only with `range=custom`. */
  from: string;
  to: string;
  compare: RevenueCompare;
  group: RevenueGroup;
  owner: string;
  team: string;
  /** Only this currency (exact figures); empty: every currency, shown converted into the workspace currency. */
  currency: string;
}

export const DEFAULT_FILTERS: RevenueFilters = {
  range: 'month',
  from: '',
  to: '',
  compare: 'previous',
  group: 'source',
  owner: '',
  team: '',
  currency: '',
};

interface SearchLike {
  get(name: string): string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Za-z]{3}$/;

const oneOf = <T extends string>(list: readonly T[], v: string | null, fallback: T): T =>
  v !== null && (list as readonly string[]).includes(v) ? (v as T) : fallback;

export function parseFilters(search: SearchLike): RevenueFilters {
  const range = oneOf(REVENUE_RANGES, search.get('range'), DEFAULT_FILTERS.range);
  const id = (v: string | null) => (v && UUID.test(v) ? v : '');
  const date = (v: string | null) => (v && DATE.test(v) ? v : '');
  const currency = search.get('currency');
  return {
    range,
    from: range === 'custom' ? date(search.get('from')) : '',
    to: range === 'custom' ? date(search.get('to')) : '',
    compare: oneOf(REVENUE_COMPARES, search.get('compare'), DEFAULT_FILTERS.compare),
    group: oneOf(REVENUE_GROUPS, search.get('group'), DEFAULT_FILTERS.group),
    owner: id(search.get('owner')),
    team: id(search.get('team')),
    currency: currency && CURRENCY.test(currency) ? currency.toUpperCase() : '',
  };
}

export function filtersToSearch(f: RevenueFilters): string {
  const p = new URLSearchParams();
  if (f.range !== DEFAULT_FILTERS.range) p.set('range', f.range);
  if (f.range === 'custom') {
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
  }
  if (f.compare !== DEFAULT_FILTERS.compare) p.set('compare', f.compare);
  if (f.group !== DEFAULT_FILTERS.group) p.set('group', f.group);
  if (f.owner) p.set('owner', f.owner);
  if (f.team) p.set('team', f.team);
  if (f.currency) p.set('currency', f.currency);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Anything that differs from the defaults earns a reset button. */
export const isDefault = (f: RevenueFilters): boolean => filtersToSearch(f) === '';

/**
 * The query the API takes. With one currency picked the figures are that currency's own; otherwise they are converted into
 * `convertTo` (the workspace currency) and the per-currency amounts come along.
 */
export function apiQuery(f: RevenueFilters, convertTo: string): Record<string, string | undefined> {
  return {
    range: f.range,
    from: f.range === 'custom' ? f.from || undefined : undefined,
    to: f.range === 'custom' ? f.to || undefined : undefined,
    compare: f.compare,
    groupBy: f.group,
    ownerId: f.owner || undefined,
    teamId: f.team || undefined,
    currency: f.currency || undefined,
    convertTo: f.currency ? undefined : convertTo,
  };
}

/** The body of a request for a file: the same filters, plus which file. */
export function exportBody(
  f: RevenueFilters,
  convertTo: string,
  file: Pick<RequestRevenueExport, 'format' | 'csvKind'>,
): RequestRevenueExport {
  const q = apiQuery(f, convertTo);
  return {
    range: f.range,
    from: q.from,
    to: q.to,
    compare: f.compare,
    groupBy: f.group,
    ownerId: q.ownerId,
    teamId: q.teamId,
    currency: q.currency,
    convertTo: q.convertTo,
    format: file.format,
    csvKind: file.csvKind,
  };
}
