/** The pure half of the broadcast list screen (TW-BCAST-001, 002): filters in the URL, labels, tones, schedule text. */

export const RANGES = ['all', '7d', '30d', '90d'] as const;
export type Range = (typeof RANGES)[number];

/** The five views of the left rail, in Reference's order; `all` means no status filter. */
export const STATUS_VIEWS = ['all', 'scheduled', 'processing', 'completed', 'failed'] as const;

export const PAGE_SIZE = 12;

export interface ListState {
  status: string;
  range: Range;
  q: string;
  /** 1-based. */
  page: number;
}

export const DEFAULT_STATE: ListState = { status: 'all', range: 'all', q: '', page: 1 };

export function parseState(search: URLSearchParams): ListState {
  const range = search.get('range') as Range | null;
  const page = Number(search.get('page'));
  return {
    status: search.get('status')?.trim() || 'all',
    range: range && (RANGES as readonly string[]).includes(range) ? range : 'all',
    q: search.get('q')?.trim() ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Only what differs from the default goes into the address, as Reference's did. */
export function stateToSearch(s: ListState): string {
  const p = new URLSearchParams();
  if (s.status !== 'all') p.set('status', s.status);
  if (s.range !== 'all') p.set('range', s.range);
  if (s.q) p.set('q', s.q);
  if (s.page > 1) p.set('page', String(s.page));
  const out = p.toString();
  return out ? `?${out}` : '';
}

export const totalPages = (total: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size));

/** `completed_with_errors` reads "Completed With Errors". */
export const statusLabel = (status: string) =>
  status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export type Tone = 'solid' | 'warning' | 'success' | 'danger' | 'neutral';

export function statusTone(status: string): Tone {
  switch (status) {
    case 'completed':
      return 'solid';
    case 'completed_with_errors':
    case 'scheduled':
      return 'warning';
    case 'processing':
      return 'success';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

const PROVIDERS: Record<string, string> = {
  baileys: 'Unofficial API',
  waba: 'WABA',
  twilio: 'Twilio',
};
export const providerLabel = (p: string | null) => PROVIDERS[(p ?? '').toLowerCase()] ?? '—';

/** Reference showed `BR-0042` from the numeric id; ids are uuids here, so the reference is the start of the uuid. */
export const reference = (uuid: string) => `BR-${uuid.slice(0, 8).toUpperCase()}`;

/** Only a broadcast that has not started, or that failed, can be deleted. */
export const canDelete = (status: string) => status === 'scheduled' || status === 'failed';

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const hm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** "Today, 14:30" or "Oct 02, 14:30"; null when there is no schedule. */
export function scheduleText(iso: string | null, now: Date, today: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (sameDay(d, now)) return `${today}, ${hm(d)}`;
  const month = d.toLocaleString('en', { month: 'short' });
  return `${month} ${String(d.getDate()).padStart(2, '0')}, ${hm(d)}`;
}

/** The one-decimal percentages the tiles show, from the summary's numbers. */
export const pct1 = (n: number) => n.toFixed(1);
