import { msg, type Msg } from './msg';
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

/** "5 minutes ago": the card's `Edited <relative>` line, as a message the card resolves. */
export function relativeTime(iso: string, now = Date.now()): Msg {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return msg('card.relative.justNow');
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
  return msg(`card.relative.${label}`, { n: Math.max(1, Math.round(s / div)) });
}

/** The message key of the "purpose" sentence for a category (several categories share one). */
const PURPOSE_KEY: Record<string, string> = {
  welcome: 'welcome',
  cart: 'cart',
  'cart-recovery': 'cart',
  'post-purchase': 'postPurchase',
  're-engagement': 'reEngagement',
  lead: 'lead',
  'lead-nurture': 'lead',
  event: 'event',
  'special-events': 'event',
};
/** The static "purpose" sentence under a card title, picked by category (there is no description column). */
export const purposeOf = (category: string | null): Msg =>
  msg(`card.purpose.${PURPOSE_KEY[category ?? ''] ?? 'default'}`);
