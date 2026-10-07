import {
  DEFAULT_FILTERS,
  PAGE_SIZES,
  type ConsentFilter,
  type ContactFilters,
  type PageSize,
} from '../api/contacts';

/**
 * The list filters live in the URL (`?q=&group=&tag=&stage=&consent=&imported=&segment=&per=&order=&page=`), as they did in Reference,
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

/** The ad-hoc rules text of a `rules=` parameter: kept only when it is JSON of a sane size; the server checks the tree itself. */
function cleanRules(v: string | null): string {
  if (!v || v.length > 20_000) return '';
  try {
    JSON.parse(v);
    return v;
  } catch {
    return '';
  }
}

/** A 1-based page number; anything else is page 1. Capped so a hand-edited URL cannot ask for a million pages. */
function cleanPage(v: string | null): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 100_000) : 1;
}

/** `defaultLimit` is the remembered rows-per-page; a valid `per=` in the URL still wins. */
export function parseFilters(
  params: Params,
  defaultLimit: PageSize = DEFAULT_FILTERS.limit,
): ContactFilters {
  const per = Number(params.get('per'));
  const limit = (PAGE_SIZES as readonly number[]).includes(per) ? (per as PageSize) : defaultLimit;
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
    segment: cleanId(params.get('segment'), false),
    rules: cleanRules(params.get('rules')),
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    limit,
    page: cleanPage(params.get('page')),
  };
}

/** Only non-default values are written, so the clean URL is `/contacts`. */
export function filtersToSearch(
  f: ContactFilters,
  defaultLimit: PageSize = DEFAULT_FILTERS.limit,
): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.group) p.set('group', f.group);
  if (f.tag) p.set('tag', f.tag);
  if (f.lifecycleStage) p.set('stage', f.lifecycleStage);
  if (f.consent) p.set('consent', f.consent);
  if (f.imported) p.set('imported', '1');
  if (f.segment) p.set('segment', f.segment);
  if (f.rules) p.set('rules', f.rules);
  if (f.order !== DEFAULT_FILTERS.order) p.set('order', f.order);
  if (f.limit !== defaultLimit) p.set('per', String(f.limit));
  if (f.page > 1) p.set('page', String(f.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Any filter that narrows the list: the empty state offers "Reset filters" only when one is on. */
export function hasActiveFilter(f: ContactFilters): boolean {
  return Boolean(
    f.q.trim() ||
    f.group ||
    f.tag ||
    f.lifecycleStage ||
    f.consent ||
    f.imported ||
    f.segment ||
    f.rules,
  );
}
