import { FLOW_PAGE_SIZE, flowStatusFilterSchema, type FlowStatusFilter } from '@crm/contracts';

/** The flows list's state lives in the address (status, category, q, page) so back and forward re-fetch (WD-FLB-001). */
export interface ListState {
  status: FlowStatusFilter;
  category: string;
  q: string;
  /** 1-based. */
  page: number;
}

export const PAGE_SIZE = FLOW_PAGE_SIZE;
export const SEARCH_DEBOUNCE_MS = 220;
export const DEFAULT_STATE: ListState = { status: 'all', category: 'all', q: '', page: 1 };

export function parseState(params: { get(name: string): string | null }): ListState {
  const status = flowStatusFilterSchema.safeParse(params.get('status') ?? 'all');
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  return {
    status: status.success ? status.data : 'all',
    category: (params.get('category') ?? 'all').slice(0, 64) || 'all',
    q: (params.get('q') ?? '').slice(0, 200),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** `/flows?status=paused`: defaults are left out so the URL stays clean. */
export function toSearch(s: Partial<ListState>): string {
  const p = new URLSearchParams();
  if (s.status && s.status !== 'all') p.set('status', s.status);
  if (s.category && s.category !== 'all') p.set('category', s.category);
  if (s.q) p.set('q', s.q);
  if (s.page && s.page > 1) p.set('page', String(s.page));
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

/** Page numbers with gaps, as WaDesk's pager draws them: all of them up to 7, else first, neighbours of the current, last. */
export function pageItems(current: number, last: number): Array<number | 'gap-a' | 'gap-b'> {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const start = Math.max(1, current - 1);
  const end = Math.min(last, current + 1);
  const out: Array<number | 'gap-a' | 'gap-b'> = [1];
  if (start > 2) out.push('gap-a');
  for (let p = start; p <= end; p++) if (p > 1 && p < last) out.push(p);
  if (end < last - 1) out.push('gap-b');
  out.push(last);
  return out;
}

export const lastPage = (total: number, size = PAGE_SIZE): number =>
  Math.max(1, Math.ceil(total / size));

/** "5 minutes ago": the card's `Edited <relative>` line. */
export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  const units: Array<[number, string]> = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
    [2592000, 'month'],
    [31536000, 'year'],
  ];
  let label = 'minute';
  let div = 60;
  for (const [limit, name] of units) {
    if (s >= limit) {
      label = name;
      div = limit;
    }
  }
  const n = Math.max(1, Math.round(s / div));
  return `${n} ${label}${n === 1 ? '' : 's'} ago`;
}

const PURPOSE: Record<string, string> = {
  welcome: 'Routes new subscribers into catalog, support, or first-order incentive paths.',
  cart: 'Triggers after checkout drop-off with product context and a support fallback.',
  'cart-recovery': 'Triggers after checkout drop-off with product context and a support fallback.',
  'post-purchase': 'Follows up after delivery to drive reviews, repeat orders, and feedback.',
  're-engagement': 'Re-activates dormant contacts with a personalised offer or check-in.',
  lead: 'Nurtures new leads with educational touches before handing to sales.',
  'lead-nurture': 'Nurtures new leads with educational touches before handing to sales.',
  event: 'Time-boxed broadcast around a launch, sale, or seasonal moment.',
  'special-events': 'Time-boxed broadcast around a launch, sale, or seasonal moment.',
};
/** The static "purpose" sentence under a card title, picked by category (there is no description column). */
export const purposeOf = (category: string | null): string =>
  PURPOSE[category ?? ''] ?? 'Automated WhatsApp journey built in the flow editor.';

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
