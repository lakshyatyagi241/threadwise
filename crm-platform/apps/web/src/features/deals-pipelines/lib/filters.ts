import { DEAL_SOURCES, type Deal, type DealSource } from '../api/schemas';

export type DealsView = 'board' | 'list';
export type StatusFilter = '' | 'open' | 'won' | 'lost';

export interface DealFilters {
  pipeline: string;
  q: string;
  /** A member id, `none` for unassigned, or empty for everyone. */
  owner: string;
  source: DealSource | '';
  status: StatusFilter;
  view: DealsView;
  /** The deal whose drawer is open (`?deal=`). */
  deal: string;
}

export const DEFAULT_FILTERS: DealFilters = {
  pipeline: '',
  q: '',
  owner: '',
  source: '',
  status: '',
  view: 'board',
  deal: '',
};

interface SearchLike {
  get(name: string): string | null;
}

const isSource = (v: string): v is DealSource => (DEAL_SOURCES as readonly string[]).includes(v);

/** Reads the board's state from the address; unknown values fall back to the defaults instead of failing. */
export function parseFilters(search: SearchLike): DealFilters {
  const source = search.get('source') ?? '';
  const status = search.get('status') ?? '';
  const view = search.get('view');
  return {
    pipeline: search.get('pipeline') ?? '',
    q: (search.get('q') ?? '').slice(0, 200),
    owner: search.get('owner') ?? '',
    source: isSource(source) ? source : '',
    status: status === 'open' || status === 'won' || status === 'lost' ? status : '',
    view: view === 'list' ? 'list' : 'board',
    deal: search.get('deal') ?? '',
  };
}

/** The `?query` for these filters; defaults are left out so the plain board keeps a plain address. */
export function filtersToSearch(f: DealFilters): string {
  const p = new URLSearchParams();
  if (f.pipeline) p.set('pipeline', f.pipeline);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.owner) p.set('owner', f.owner);
  if (f.source) p.set('source', f.source);
  if (f.status && f.view === 'list') p.set('status', f.status);
  if (f.view === 'list') p.set('view', 'list');
  if (f.deal) p.set('deal', f.deal);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Search, owner and source narrow the cards; the pipeline and the view do not count as a filter. */
export function hasActiveFilter(
  f: Pick<DealFilters, 'q' | 'owner' | 'source' | 'status'>,
): boolean {
  return f.q.trim() !== '' || f.owner !== '' || f.source !== '' || f.status !== '';
}

/** The same test the server applies, for a deal created or edited on this screen. */
export function matchesFilters(
  deal: Pick<Deal, 'title' | 'owner' | 'source' | 'status'>,
  f: Pick<DealFilters, 'q' | 'owner' | 'source' | 'status'>,
): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !deal.title.toLowerCase().includes(q)) return false;
  if (f.owner === 'none' && deal.owner) return false;
  if (f.owner && f.owner !== 'none' && deal.owner?.id !== f.owner) return false;
  if (f.source && deal.source !== f.source) return false;
  if (f.status && deal.status !== f.status) return false;
  return true;
}

/** The query the board and list endpoints take (empty values are dropped by the client). */
export function filterQuery(f: DealFilters): Record<string, string | undefined> {
  return {
    q: f.q.trim() || undefined,
    ownerId: f.owner && f.owner !== 'none' ? f.owner : undefined,
    unassigned: f.owner === 'none' ? 'true' : undefined,
    source: f.source || undefined,
  };
}
