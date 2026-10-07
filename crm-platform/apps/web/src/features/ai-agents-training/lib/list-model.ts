import type { AiagAssistant, AiagStats } from '@crm/contracts';

/** The four stat cards (WD-AIAG-001): entries per agent to one decimal and the share of agents that are active. */
export interface StatCards {
  all: number;
  active: number;
  paused: number;
  sources: number;
  ready: number;
  /** Entries divided by agents, one decimal; "0" when there are no agents. */
  avgPerAgent: string;
  healthPct: number;
  health: 'healthy' | 'empty' | 'attention';
}

export function statCards(s: AiagStats): StatCards {
  return {
    all: s.all,
    active: s.active,
    // WaDesk derived "paused" as all minus active.
    paused: Math.max(0, s.all - s.active),
    sources: s.sources,
    ready: s.ready,
    avgPerAgent: s.all > 0 ? (s.sources / s.all).toFixed(1) : '0',
    healthPct: s.all > 0 ? Math.round((s.active / Math.max(s.all, 1)) * 100) : 0,
    health: s.all === 0 ? 'empty' : s.active === s.all ? 'healthy' : 'attention',
  };
}

export const STATUS_FILTERS = ['all', 'active', 'paused'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const matchesStatus = (a: Pick<AiagAssistant, 'status'>, f: StatusFilter): boolean =>
  f === 'all' || a.status === f;

/** The client-side search: lower-cased name and slug, over the rows that are loaded (as WaDesk's). */
export const matchesSearch = (a: Pick<AiagAssistant, 'name' | 'slug'>, q: string): boolean => {
  const needle = q.trim().toLowerCase();
  return needle === '' || `${a.name} ${a.slug}`.toLowerCase().includes(needle);
};

export const STATUS_PILL = {
  active: { box: 'bg-emerald-100 text-emerald-900', dot: 'bg-emerald-500' },
  paused: { box: 'bg-muted text-muted-foreground', dot: 'bg-border' },
} as const;

/** Provider pills: three vendors have their own tint (as in WaDesk), every other falls back to the first. */
export const PROVIDER_PILL: Record<string, { box: string; dot: string }> = {
  openai: { box: 'bg-emerald-100 text-emerald-900', dot: 'bg-emerald-500' },
  anthropic: { box: 'bg-violet-100 text-violet-900', dot: 'bg-violet-600' },
  gemini: { box: 'bg-sky-100 text-sky-900', dot: 'bg-sky-600' },
};
export const providerPill = (slug: string) => PROVIDER_PILL[slug] ?? PROVIDER_PILL.openai!;

const ACCENTS = [
  'bg-emerald-100 text-emerald-900',
  'bg-sky-100 text-sky-900',
  'bg-violet-100 text-violet-900',
  'bg-muted text-foreground',
] as const;
/** Row icon tints cycle over four colours; WaDesk used `id % 4`, a uuid gets its first hex digit. */
export const accentFor = (uuid: string): string =>
  ACCENTS[Number.parseInt(uuid.charAt(0) || '0', 16) % 4] ?? ACCENTS[0];

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
