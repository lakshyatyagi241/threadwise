import { APPOINTMENT_STATUSES, type AppointmentStatus } from '../api/schemas';
import { parseDayKey } from './zone';

export const TABS = ['upcoming', 'past'] as const;
export type AppointmentTab = (typeof TABS)[number];

export const VIEWS = ['list', 'week', 'month'] as const;
export type AppointmentView = (typeof VIEWS)[number];

/** Everything the screen keeps in the address, so a link reopens the same tab, filters, calendar page and booking. */
export interface AppointmentFilters {
  tab: AppointmentTab;
  view: AppointmentView;
  /** One status, or '' for the tab's own set (upcoming: pending and confirmed; past: every status). */
  status: '' | AppointmentStatus;
  /** A booking type id, or ''. */
  type: string;
  q: string;
  /** The day the calendar is on (`YYYY-MM-DD`), or '' for today. */
  day: string;
  /** The open booking's id, or ''. */
  appt: string;
}

export const DEFAULT_FILTERS: AppointmentFilters = {
  tab: 'upcoming',
  view: 'list',
  status: '',
  type: '',
  q: '',
  day: '',
  appt: '',
};

type Source = { get(name: string): string | null };

const oneOf = <T extends string>(list: readonly T[], v: string | null, fallback: T): T =>
  v !== null && (list as readonly string[]).includes(v) ? (v as T) : fallback;

/** The filters in an address; anything unreadable falls back to its default. */
export function parseFilters(params: Source): AppointmentFilters {
  const day = params.get('day') ?? '';
  return {
    tab: oneOf(TABS, params.get('tab'), DEFAULT_FILTERS.tab),
    view: oneOf(VIEWS, params.get('view'), DEFAULT_FILTERS.view),
    status: oneOf(['', ...APPOINTMENT_STATUSES] as const, params.get('status'), ''),
    type: (params.get('type') ?? '').trim(),
    q: (params.get('q') ?? '').trim(),
    day: parseDayKey(day) ? day : '',
    appt: (params.get('appt') ?? '').trim(),
  };
}

/** `?tab=past&q=ana`: only what differs from the defaults, so the plain screen keeps a plain address. */
export function filtersToSearch(f: AppointmentFilters): string {
  const p = new URLSearchParams();
  for (const key of Object.keys(DEFAULT_FILTERS) as Array<keyof AppointmentFilters>) {
    if (f[key] !== DEFAULT_FILTERS[key] && f[key] !== '') p.set(key, f[key]);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Is anything narrowing the list (the tab and the view are not filters)? */
export const hasActiveFilter = (f: Pick<AppointmentFilters, 'status' | 'type' | 'q'>): boolean =>
  f.status !== '' || f.type !== '' || f.q.trim() !== '';

type Query = Record<string, string | number | boolean | undefined>;

/** The list's query: the tab, the filters, and the page size. */
export function listQuery(f: AppointmentFilters): Query {
  return {
    tab: f.tab,
    status: f.status || undefined,
    typeId: f.type || undefined,
    q: f.q.trim() || undefined,
  };
}

/** The tab badges follow the search and the type but not the status (they count what each tab would hold). */
export function countsQuery(f: AppointmentFilters): Query {
  return { typeId: f.type || undefined, q: f.q.trim() || undefined };
}

/** What the calendar shows by default: everything that still holds a time. Cancelled ones appear when asked for. */
export const CALENDAR_DEFAULT_STATUSES: readonly AppointmentStatus[] = [
  'pending',
  'confirmed',
  'completed',
  'no_show',
];

/** The calendar's query: a range of instants plus the filters. The range is half-open, `[from, to)`. */
export function rangeQuery(f: AppointmentFilters, range: { from: string; to: string }): Query {
  return {
    from: range.from,
    to: range.to,
    status: f.status || CALENDAR_DEFAULT_STATUSES.join(','),
    typeId: f.type || undefined,
    q: f.q.trim() || undefined,
  };
}
