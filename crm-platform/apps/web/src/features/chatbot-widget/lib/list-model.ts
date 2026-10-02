import type { WidgetListItem, WidgetMode, WidgetStats, WidgetStatus } from '@crm/contracts';

/** The four stat cards (WD-WGT-001): visitors per widget to one decimal, and the share of widgets that are active. */
export interface StatCards {
  total: number;
  active: number;
  visitors: number;
  /** Visitors divided by widgets, one decimal; "0" when there are no widgets. */
  avgPerWidget: string;
  healthPct: number;
  health: 'healthy' | 'empty' | 'attention';
  paused: number;
}

export function statCards(s: WidgetStats): StatCards {
  const avg = s.total > 0 ? (s.visitors / s.total).toFixed(1) : '0';
  const healthPct = s.total > 0 ? Math.round((s.active / Math.max(s.total, 1)) * 100) : 0;
  const health = s.total === 0 ? 'empty' : s.active === s.total ? 'healthy' : 'attention';
  return {
    total: s.total,
    active: s.active,
    visitors: s.visitors,
    avgPerWidget: avg,
    healthPct,
    health,
    // WaDesk derived "paused" as all minus active.
    paused: Math.max(0, s.total - s.active),
  };
}

export const STATUS_FILTERS = ['all', 'active', 'paused'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** The pill colours of the engine column: AI, WhatsApp and both each have their own. */
export const MODE_PILL: Record<WidgetMode, { label: string; box: string; dot: string }> = {
  ai: { label: 'AI', box: 'bg-emerald-100 text-emerald-900', dot: 'bg-emerald-500' },
  whatsapp: { label: 'WhatsApp', box: 'bg-sky-100 text-sky-900', dot: 'bg-sky-600' },
  both: { label: 'AI + WA', box: 'bg-violet-100 text-violet-900', dot: 'bg-violet-600' },
};

export const STATUS_PILL: Record<WidgetStatus, { box: string; dot: string }> = {
  active: { box: 'bg-emerald-100 text-emerald-900', dot: 'bg-emerald-500' },
  paused: { box: 'bg-muted text-muted-foreground', dot: 'bg-border' },
};

/** Row icon tints cycle over four colours; WaDesk used `id % 4`, a uuid gets its first hex digit. */
const ACCENTS = [
  'bg-emerald-100 text-emerald-900',
  'bg-sky-100 text-sky-900',
  'bg-violet-100 text-violet-900',
  'bg-muted text-foreground',
] as const;
export const accentFor = (uuid: string): string =>
  ACCENTS[Number.parseInt(uuid.charAt(0) || '0', 16) % 4] ?? ACCENTS[0];

/** The client-side search of the list: lower-cased name and slug, over the rows that are loaded. */
export const matchesSearch = (w: Pick<WidgetListItem, 'name' | 'slug'>, q: string): boolean => {
  const needle = q.trim().toLowerCase();
  return needle === '' || `${w.name} ${w.slug}`.toLowerCase().includes(needle);
};

/** Short relative time, as the Updated column shows it ("2s ago", "5m ago", "3h ago", "2d ago", "1w ago", "4mo ago"). */
export function relativeShort(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 02, 08:00" in the viewer's time zone. */
export function stampShort(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${p(d.getDate())}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The tag the copy button puts on the clipboard. */
export const snippetTag = (embedUrl: string): string => `<script defer src="${embedUrl}"></script>`;
