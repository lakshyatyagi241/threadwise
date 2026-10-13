import type { NotificationResponse } from '@crm/contracts';

/**
 * The state of the full Notifications page (/notifications): kept in the URL (`?read=unread&type=...&q=...`), parsed defensively,
 * and the day sections the feed is drawn in. Pure: tested without a browser.
 */

export interface PageFilters {
  /** `unread` shows only unread rows (Reference's Unread tab). */
  read: 'all' | 'unread';
  type: string;
  q: string;
}

export const EMPTY_PAGE_FILTERS: PageFilters = { read: 'all', type: '', q: '' };

export function parsePageFilters(params: URLSearchParams): PageFilters {
  const type = (params.get('type') ?? '').trim();
  return {
    read: params.get('read') === 'unread' ? 'unread' : 'all',
    // A type name is a short identifier; anything else in a hand-edited URL is ignored.
    type: /^[a-z][a-z0-9_]{0,59}$/.test(type) ? type : '',
    q: (params.get('q') ?? '').trim().slice(0, 100),
  };
}

export function toPageSearch(f: PageFilters): string {
  const p = new URLSearchParams();
  if (f.read === 'unread') p.set('read', 'unread');
  if (f.type) p.set('type', f.type);
  if (f.q) p.set('q', f.q);
  return p.toString();
}

export const isPageFiltered = (f: PageFilters): boolean => f.read !== 'all' || !!f.type || !!f.q;

export type DaySection = 'today' | 'yesterday' | 'thisWeek' | 'older';
export const DAY_SECTIONS: readonly DaySection[] = ['today', 'yesterday', 'thisWeek', 'older'];

const startOfDay = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Which section a moment falls in, by the viewer's calendar days: today, yesterday, the last week, older. */
export function sectionOf(at: Date, now: Date): DaySection {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'thisWeek';
  return 'older';
}

/** The rows grouped in section order (empty sections left out), each section keeping the server's newest-first order. */
export function groupByDay(
  rows: readonly NotificationResponse[],
  now: Date,
): Array<{ section: DaySection; rows: NotificationResponse[] }> {
  const by = new Map<DaySection, NotificationResponse[]>();
  for (const r of rows) {
    const s = sectionOf(new Date(r.createdAt), now);
    (by.get(s) ?? by.set(s, []).get(s)!).push(r);
  }
  return DAY_SECTIONS.filter((s) => by.has(s)).map((section) => ({
    section,
    rows: by.get(section)!,
  }));
}
