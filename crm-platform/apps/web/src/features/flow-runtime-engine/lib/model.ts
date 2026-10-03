/** The pure half of the flow runtime screens (FLR): labels, tones, durations, URL state, cursor paging and enrollment helpers. */
import {
  FLOW_LIVE_RUN_STATUSES,
  FLOW_ENROLL_MAX_CONTACTS,
  FLOW_RUN_SOURCES,
  FLOW_RUN_STATUSES,
  FLOW_SUBSCRIBER_STATUSES,
  FLR_ERROR_CODES,
  type EnrollResult,
  type FlowAnalytics,
  type FlowRunStatus,
  type FlowSubscriberStatus,
} from '@crm/contracts';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

export const RUNS_PAGE_SIZE = 25;
export const SUBSCRIBERS_PAGE_SIZE = 100;
export const ANALYTICS_DAYS = [7, 30, 90] as const;
export type AnalyticsDays = (typeof ANALYTICS_DAYS)[number];
export const DEFAULT_DAYS: AnalyticsDays = 30;

export const isLive = (status: FlowRunStatus) => FLOW_LIVE_RUN_STATUSES.includes(status);

const RUN_TONES: Record<FlowRunStatus, Tone> = {
  running: 'success',
  waiting: 'warning',
  sleeping: 'warning',
  halted: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
};
export const runTone = (s: FlowRunStatus): Tone => RUN_TONES[s];

const SUBSCRIBER_TONES: Record<FlowSubscriberStatus, Tone> = {
  active: 'success',
  paused: 'warning',
  completed: 'neutral',
  failed: 'danger',
};
export const subscriberTone = (s: FlowSubscriberStatus): Tone => SUBSCRIBER_TONES[s];

/** `peer_key` or an unnamed contact still needs something to show. */
export const contactLabel = (c: { name: string | null } | null, fallback: string) =>
  c?.name?.trim() || fallback;

// --- durations ---------------------------------------------------------------------------------------------------------

export type DurationUnit = 's' | 'm' | 'h' | 'd';

/** WaDesk's rule: seconds under a minute, minutes under an hour, hours (+ minutes) under a day, days (+ hours) after. */
export function durationParts(seconds: number | null): Array<[DurationUnit, number]> | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return [['s', s]];
  if (s < 3600) return [['m', Math.floor(s / 60)]];
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m > 0
      ? [
          ['h', h],
          ['m', m],
        ]
      : [['h', h]];
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h > 0
    ? [
        ['d', d],
        ['h', h],
      ]
    : [['d', d]];
}

/** Whole seconds between two ISO times; `end` defaults to now. Null when a time is unreadable. */
export function secondsBetween(
  startIso: string,
  endIso: string | null,
  now = Date.now(),
): number | null {
  const a = Date.parse(startIso);
  const b = endIso ? Date.parse(endIso) : now;
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 1000)) : null;
}

/** 0..1 to "62.5%"; null stays null so the tile can say "no finished runs yet" instead of a fake 0. */
export function percent(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  const p = Math.round(rate * 1000) / 10;
  return `${p}%`;
}

// --- reasons -----------------------------------------------------------------------------------------------------------

export type ReasonKind = 'loop' | 'unknown' | 'paused' | 'other';

/**
 * The engine writes reasons as plain text. A few have a fixed shape worth a translated lead line; every other reason is shown
 * as written.
 */
export function reasonKind(reason: string | null): ReasonKind {
  const r = (reason ?? '').trim();
  if (!r || r.toLowerCase() === 'unknown') return 'unknown';
  if (/^node .+ ran more than \d+ times/i.test(r)) return 'loop';
  if (r === 'paused') return 'paused';
  return 'other';
}

/** Message key (under `errors`) for a problem+json code the FLR screens know; null for the generic fallback. */
export function errorKey(code: string): string | null {
  switch (code) {
    case FLR_ERROR_CODES.FLR_FLOW_INACTIVE:
      return 'flowInactive';
    case FLR_ERROR_CODES.FLR_FLOW_NOT_FOUND:
      return 'flowNotFound';
    case FLR_ERROR_CODES.FLR_RUN_NOT_FOUND:
      return 'runNotFound';
    case FLR_ERROR_CODES.FLR_RUN_STATE_CONFLICT:
      return 'runStateConflict';
    case FLR_ERROR_CODES.FLR_NOT_RETRYABLE:
      return 'notRetryable';
    case FLR_ERROR_CODES.FLR_FLOW_EMPTY:
      return 'flowEmpty';
    case FLR_ERROR_CODES.FLR_CONVERSATION_NOT_FOUND:
      return 'conversationNotFound';
    case FLR_ERROR_CODES.FLR_SUBSCRIBER_NOT_FOUND:
      return 'subscriberNotFound';
    case FLR_ERROR_CODES.FLR_CONTACT_NOT_FOUND:
      return 'contactNotFound';
    default:
      return null;
  }
}

/** A step's `detail` as short "key: value" pairs (notes the runtime attached); nested values are cut to one line. */
export function detailPairs(detail: Record<string, unknown>, max = 140): Array<[string, string]> {
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      const text = typeof v === 'string' ? v : JSON.stringify(v);
      return [k, text.length > max ? `${text.slice(0, max - 1)}…` : text] as [string, string];
    });
}

// --- URL state and queries ---------------------------------------------------------------------------------------------

export interface RunsState {
  status: FlowRunStatus | 'all';
  source: string;
  flowId: string;
}
export const DEFAULT_RUNS_STATE: RunsState = { status: 'all', source: 'all', flowId: '' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isStatus = (v: string | null): v is FlowRunStatus =>
  !!v && (FLOW_RUN_STATUSES as readonly string[]).includes(v);

export function parseRunsState(search: URLSearchParams): RunsState {
  const status = search.get('status');
  const source = search.get('source');
  const flowId = search.get('flowId') ?? '';
  return {
    status: isStatus(status) ? status : 'all',
    source: source && (FLOW_RUN_SOURCES as readonly string[]).includes(source) ? source : 'all',
    flowId: UUID.test(flowId) ? flowId : '',
  };
}

/** Only what differs from the default goes into the address. */
export function runsStateToSearch(s: RunsState): string {
  const p = new URLSearchParams();
  if (s.status !== 'all') p.set('status', s.status);
  if (s.source !== 'all') p.set('source', s.source);
  if (s.flowId) p.set('flowId', s.flowId);
  const out = p.toString();
  return out ? `?${out}` : '';
}

/** The API's query for a runs page; `undefined` values are dropped by the client. */
export const runsQuery = (s: RunsState, cursor?: string) => ({
  status: s.status === 'all' ? undefined : s.status,
  source: s.source === 'all' ? undefined : s.source,
  flowId: s.flowId || undefined,
  limit: RUNS_PAGE_SIZE,
  cursor,
});

export function parseSubscriberStatus(v: string | null): FlowSubscriberStatus | 'all' {
  return (FLOW_SUBSCRIBER_STATUSES as readonly string[]).includes(v ?? '')
    ? (v as FlowSubscriberStatus)
    : 'all';
}

export function parseDays(v: string | null): AnalyticsDays {
  const n = Number(v);
  return (ANALYTICS_DAYS as readonly number[]).includes(n) ? (n as AnalyticsDays) : DEFAULT_DAYS;
}

// --- cursor paging -----------------------------------------------------------------------------------------------------

/** The cursor of the next page, or undefined when this was the last one (a null or empty cursor ends the list). */
export const nextCursor = (page: { nextCursor: string | null }): string | undefined =>
  page.nextCursor || undefined;

/** Pages in order, flattened; a row that shows up twice because the list moved between pages is kept once. */
export function flattenPages<T extends { id: string }>(pages: Array<{ items: T[] }>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages)
    for (const it of page.items)
      if (!seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
  return out;
}

// --- enrollment --------------------------------------------------------------------------------------------------------

export const ENROLL_MAX = FLOW_ENROLL_MAX_CONTACTS;

/** Adds ids to a selection without duplicates and without passing the 500 cap; `dropped` is how many did not fit. */
export function addToSelection(current: string[], add: string[], max = ENROLL_MAX) {
  const set = new Set(current);
  let dropped = 0;
  for (const id of add) {
    if (set.has(id)) continue;
    if (set.size >= max) dropped++;
    else set.add(id);
  }
  return { ids: [...set], dropped };
}

export const toggleId = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= ENROLL_MAX ? ids : [...ids, id];

/** Failed contacts of an enrollment, grouped by reason (most first), for the result panel. */
export function failureGroups(result: EnrollResult): Array<{ reason: string; count: number }> {
  const by = new Map<string, number>();
  for (const r of result.results)
    if (r.outcome === 'failed') {
      const k = r.reason?.trim() || '';
      by.set(k, (by.get(k) ?? 0) + 1);
    }
  return [...by].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

export const contactName = (c: {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
}) => c.name?.trim() || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();

// --- analytics ---------------------------------------------------------------------------------------------------------

/** `2026-10-03` to `10-03` for the chart axis; anything else is shown as given. */
export const dayLabel = (day: string) => (/^\d{4}-\d{2}-\d{2}/.test(day) ? day.slice(5, 10) : day);

/** The status mix donut: only the buckets the API reports, in a fixed order. */
export function statusMix(totals: FlowAnalytics['totals']) {
  return [
    { key: 'running', value: totals.running },
    { key: 'completed', value: totals.completed },
    { key: 'failed', value: totals.failed },
    { key: 'cancelled', value: totals.cancelled },
    { key: 'expired', value: totals.expired },
  ] as const;
}

/** Per-flow completion rate over finished runs; null while none has finished. */
export function flowRate(row: { completed: number; failed: number }): number | null {
  const done = row.completed + row.failed;
  return done > 0 ? row.completed / done : null;
}

/** A source such as `any_message` as the fallback label when no translation exists. */
export const humanize = (v: string) => v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const shortId = (id: string) => id.slice(0, 8);
