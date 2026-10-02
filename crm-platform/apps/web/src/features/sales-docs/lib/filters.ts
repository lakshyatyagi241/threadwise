import { TABS, type DocTab } from './status';

/**
 * The list's state, kept in the address so a view can be shared and the back button works. The tab is the status; the
 * toolbar narrows it. Everything here is pure.
 */
export interface DocFilters {
  tab: DocTab;
  q: string;
  /** A member id, `mine` for the signed-in person, or empty for everyone. */
  owner: string;
  /** Linked contact / deal (an id) or empty. */
  contact: string;
  deal: string;
  /** `week`: valid until within 7 days. `lapsed`: valid-until date already passed. Empty: any. */
  validity: '' | 'week' | 'lapsed';
  /** The document whose activity drawer is open (`?activity=`). */
  activity: string;
}

export const DEFAULT_FILTERS: DocFilters = {
  tab: 'all',
  q: '',
  owner: '',
  contact: '',
  deal: '',
  validity: '',
  activity: '',
};

interface SearchLike {
  get(name: string): string | null;
}

/** Uuids from the API; the development stand-in uses short ids, so anything id-shaped is accepted. */
const ID = /^[0-9A-Za-z_-]{1,64}$/;
const isTab = (v: string | null): v is DocTab => (TABS as readonly (string | null)[]).includes(v);

/** Reads the state from the address; unknown or malformed values fall back to the defaults instead of failing. */
export function parseFilters(search: SearchLike): DocFilters {
  const tab = search.get('tab');
  const owner = search.get('owner') ?? '';
  const validity = search.get('validity');
  const id = (v: string | null) => (v && ID.test(v) ? v : '');
  return {
    tab: isTab(tab) ? tab : 'all',
    q: (search.get('q') ?? '').slice(0, 100),
    owner: owner === 'mine' || ID.test(owner) ? owner : '',
    contact: id(search.get('contact')),
    deal: id(search.get('deal')),
    validity: validity === 'week' || validity === 'lapsed' ? validity : '',
    activity: id(search.get('activity')),
  };
}

/** The `?query` for these filters; defaults are left out so the plain screen keeps a plain address. */
export function filtersToSearch(f: DocFilters): string {
  const p = new URLSearchParams();
  if (f.tab !== 'all') p.set('tab', f.tab);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.owner) p.set('owner', f.owner);
  if (f.contact) p.set('contact', f.contact);
  if (f.deal) p.set('deal', f.deal);
  if (f.validity) p.set('validity', f.validity);
  if (f.activity) p.set('activity', f.activity);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Anything the toolbar narrowed (the tab does not count). */
export function hasActiveFilter(
  f: Pick<DocFilters, 'q' | 'owner' | 'contact' | 'deal' | 'validity'>,
): boolean {
  return (
    f.q.trim() !== '' || f.owner !== '' || f.contact !== '' || f.deal !== '' || f.validity !== ''
  );
}

export type QueryValues = Record<string, string | number | boolean | undefined>;

/** `YYYY-MM-DD` that is `days` from `today` (negative for earlier). */
function shift(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The narrowing filters shared by the list and the counts endpoints (empty values are dropped by the client). "Valid within a
 * week" is the window today..today+7; "date has passed" is everything valid until before today.
 */
export function sharedQuery(f: DocFilters, today: string): QueryValues {
  return {
    q: f.q.trim() || undefined,
    ownerId: f.owner && f.owner !== 'mine' ? f.owner : undefined,
    mine: f.owner === 'mine' ? true : undefined,
    contactId: f.contact || undefined,
    dealId: f.deal || undefined,
    validFrom: f.validity === 'week' ? today : undefined,
    validTo:
      f.validity === 'week'
        ? shift(today, 7)
        : f.validity === 'lapsed'
          ? shift(today, -1)
          : undefined,
  };
}

/** Counts take the same narrowing filters but never the tab, so every badge answers for its own tab. */
export const countsQuery = sharedQuery;

/** The list query: the shared filters plus the tab's status (`all` sends none). */
export function listQuery(f: DocFilters, today: string): QueryValues {
  return { ...sharedQuery(f, today), status: f.tab === 'all' ? undefined : f.tab };
}

export interface CountsLike {
  all: number;
  draft: number;
  sent: number;
  viewed: number;
  accepted: number;
  declined: number;
  expired: number;
  converted: number;
}

/** The count that belongs on a tab's badge, or undefined while it is unknown. */
export function tabCount(tab: DocTab, counts: CountsLike | undefined): number | undefined {
  return counts ? counts[tab] : undefined;
}
