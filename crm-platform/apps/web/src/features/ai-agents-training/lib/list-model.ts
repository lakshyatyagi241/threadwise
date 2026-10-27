import type { AiagAssistant, AiagStats } from '@crm/contracts';

/** The four stat cards (TW-AIAG-001): entries per agent to one decimal and the share of agents that are active. */
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
    // Reference derived "paused" as all minus active.
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

/** The client-side search: lower-cased name and slug, over the rows that are loaded (as Reference's). */
export const matchesSearch = (a: Pick<AiagAssistant, 'name' | 'slug'>, q: string): boolean => {
  const needle = q.trim().toLowerCase();
  return needle === '' || `${a.name} ${a.slug}`.toLowerCase().includes(needle);
};

export const STATUS_PILL = {
  active: { box: 'bg-emerald-100 text-emerald-900', dot: 'bg-emerald-500' },
  paused: { box: 'bg-muted text-muted-foreground', dot: 'bg-border' },
} as const;

/** Provider pills: three vendors have their own tint (as in Reference), every other falls back to the first. */
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
/** Row icon tints cycle over four colours; Reference used `id % 4`, a uuid gets its first hex digit. */
export const accentFor = (uuid: string): string =>
  ACCENTS[Number.parseInt(uuid.charAt(0) || '0', 16) % 4] ?? ACCENTS[0];

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

/** One formatter per locale: Intl is slow to construct, and the list would build two for every row on every render. */
function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let rtf = relativeFormatters.get(locale);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { style: 'narrow', numeric: 'always' });
    relativeFormatters.set(locale, rtf);
  }
  return rtf;
}

/**
 * Short relative time in the viewer's language, as the Updated column shows it. Intl's narrow style gives the English forms
 * ("2s ago", "5m ago", "3h ago", "2d ago", "1w ago", "4mo ago") and the Arabic ones for an Arabic viewer.
 */
export function relativeShort(iso: string, now: number = Date.now(), locale = 'en'): string {
  const time = new Date(iso).getTime();
  // An unreadable timestamp shows a dash: Intl would throw on it and the whole list would fail to render.
  if (Number.isNaN(time)) return '—';
  const diff = Math.max(0, Math.floor((now - time) / 1000));
  const rtf = relativeFormatter(locale);
  if (diff < 60) return rtf.format(-diff, 'second');
  const m = Math.floor(diff / 60);
  if (m < 60) return rtf.format(-m, 'minute');
  const h = Math.floor(m / 60);
  if (h < 24) return rtf.format(-h, 'hour');
  const d = Math.floor(h / 24);
  if (d < 7) return rtf.format(-d, 'day');
  if (d < 30) return rtf.format(-Math.floor(d / 7), 'week');
  if (d < 365) return rtf.format(-Math.floor(d / 30), 'month');
  return rtf.format(-Math.floor(d / 365), 'year');
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: string): Intl.DateTimeFormat {
  let dtf = dateFormatters.get(locale);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    dateFormatters.set(locale, dtf);
  }
  return dtf;
}

/** "Oct 02, 08:00" in the viewer's time zone, with the month name in the viewer's language. */
export function stampShort(iso: string, locale = 'en'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter(locale).format(date);
}
