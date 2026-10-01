import {
  DEFAULT_FILTERS,
  PAGE_SIZES,
  type ConsentFilter,
  type ContactFilters,
  type PageSize,
} from '../api/contacts';

/**
 * The list filters live in the URL (`?q=&group=&tag=&stage=&consent=&imported=&per=&order=`), as they did in WaDesk,
 * so a filtered view can be bookmarked or shared and the back button restores it. Unknown or malformed values fall
 * back to the defaults: a hand-edited URL never breaks the page.
 */

type Params = Pick<URLSearchParams, 'get'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanId(v: string | null, allowNoGroup: boolean): string {
  if (!v) return '';
  if (allowNoGroup && v === 'no_group') return v;
  return UUID.test(v) ? v : '';
}

export function parseFilters(params: Params): ContactFilters {
  const per = Number(params.get('per'));
  const limit = (PAGE_SIZES as readonly number[]).includes(per)
    ? (per as PageSize)
    : DEFAULT_FILTERS.limit;
  const consent = params.get('consent');
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    group: cleanId(params.get('group'), true),
    tag: cleanId(params.get('tag'), false),
    lifecycleStage: /^[a-z][a-z0-9_]*$/.test(params.get('stage') ?? '') ? params.get('stage')! : '',
    consent: (consent === 'subscribed' || consent === 'unsubscribed'
      ? consent
      : '') as ConsentFilter,
    imported: params.get('imported') === '1',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    limit,
  };
}

/** Only non-default values are written, so the clean URL is `/contacts`. */
export function filtersToSearch(f: ContactFilters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.group) p.set('group', f.group);
  if (f.tag) p.set('tag', f.tag);
  if (f.lifecycleStage) p.set('stage', f.lifecycleStage);
  if (f.consent) p.set('consent', f.consent);
  if (f.imported) p.set('imported', '1');
  if (f.order !== DEFAULT_FILTERS.order) p.set('order', f.order);
  if (f.limit !== DEFAULT_FILTERS.limit) p.set('per', String(f.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Any filter that narrows the list: the empty state offers "Reset filters" only when one is on. */
export function hasActiveFilter(f: ContactFilters): boolean {
  return Boolean(f.q.trim() || f.group || f.tag || f.lifecycleStage || f.consent || f.imported);
}
