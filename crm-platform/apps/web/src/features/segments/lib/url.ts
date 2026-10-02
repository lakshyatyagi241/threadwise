/**
 * The hub's list state lives in the URL (`?q=&show=&per=&page=`) so a filtered list can be shared and the back button
 * restores it. Unknown or malformed values fall back to the defaults: a hand-edited URL never breaks the page.
 */

type Params = Pick<URLSearchParams, 'get'>;

export const HUB_PAGE_SIZES = [10, 25, 50, 100] as const;
export type HubPageSize = (typeof HUB_PAGE_SIZES)[number];
export const SHOW_VALUES = ['all', 'mine', 'shared'] as const;
export type Show = (typeof SHOW_VALUES)[number];

export interface HubParams {
  q: string;
  show: Show;
  per: HubPageSize;
  /** 1-based. */
  page: number;
}

export const DEFAULT_HUB: HubParams = { q: '', show: 'all', per: 25, page: 1 };

export function parseHub(params: Params): HubParams {
  const per = Number(params.get('per'));
  const page = Number(params.get('page'));
  const show = params.get('show');
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    show: (SHOW_VALUES as readonly string[]).includes(show ?? '') ? (show as Show) : 'all',
    per: (HUB_PAGE_SIZES as readonly number[]).includes(per)
      ? (per as HubPageSize)
      : DEFAULT_HUB.per,
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, 100_000) : 1,
  };
}

/** Only non-default values are written, so the clean URL is `/segments`. */
export function hubToSearch(p: HubParams): string {
  const out = new URLSearchParams();
  if (p.q.trim()) out.set('q', p.q.trim());
  if (p.show !== DEFAULT_HUB.show) out.set('show', p.show);
  if (p.per !== DEFAULT_HUB.per) out.set('per', String(p.per));
  if (p.page > 1) out.set('page', String(p.page));
  const s = out.toString();
  return s ? `?${s}` : '';
}

export const ROUTES = {
  hub: '/segments',
  create: '/segments/new',
  detail: (id: string) => `/segments/${id}`,
  edit: (id: string) => `/segments/${id}/edit`,
  /** The contacts list filtered to a segment. */
  contacts: (id: string) => `/contacts?segment=${id}`,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `segment=` value of the contacts URL: a uuid, or empty. Anything else is ignored. */
export const cleanSegmentParam = (v: string | null | undefined): string =>
  v && UUID.test(v) ? v : '';

export const isUuid = (v: string): boolean => UUID.test(v);
