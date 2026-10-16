import {
  LEAD_EVENT_STATUSES,
  LEAD_REASONS,
  type LeadEventStatus,
  type LeadInboxItem,
  type LeadInboxStatusFilter,
  type LeadSyncRun,
  type RetryLeadInboxResponse,
} from '@crm/contracts';
import type { Tone } from './event-view';

/**
 * How the lead inbox is filtered, selected and read: the pure parts of the screen, so every filter, every outcome of a bulk retry and
 * every state of a pull has a test. Nothing here reads the DOM.
 */

// --- filters -----------------------------------------------------------------------------------------------------------------------

export const INBOX_CHIPS = [
  'all',
  'attention',
  'needs_review',
  'failed',
  'created',
  'updated',
  'duplicate',
] as const;
export type InboxChip = (typeof INBOX_CHIPS)[number];

export const TEST_CHOICES = ['all', 'only', 'hide'] as const;
export type TestChoice = (typeof TEST_CHOICES)[number];

export const RANGE_CHOICES = ['all', 'day', 'week', 'month', 'custom'] as const;
export type RangeChoice = (typeof RANGE_CHOICES)[number];

export interface InboxFilters {
  status: InboxChip;
  /** A source's uuid; empty = every source. */
  sourceId: string;
  /** A reason code; empty = any. */
  reason: string;
  tests: TestChoice;
  range: RangeChoice;
  /** `YYYY-MM-DD` of a custom range (the person's own days). */
  from: string;
  to: string;
  /** The start of the sender's own id. */
  q: string;
}

/** What the screen starts on: the leads that wait, because that is what people open it for. */
export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  status: 'attention',
  sourceId: '',
  reason: '',
  tests: 'hide',
  range: 'all',
  from: '',
  to: '',
  q: '',
};

export const ALL_INBOX_FILTERS: InboxFilters = {
  ...DEFAULT_INBOX_FILTERS,
  status: 'all',
  tests: 'all',
};

/** The reasons worth filtering by: a lead that waits has one of these. */
export const REASON_CHOICES: readonly string[] = LEAD_REASONS.filter((r) => r !== 'source_paused');

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight at the start of a `YYYY-MM-DD` day in the person's own time zone, as an instant; null when it is not a date. */
export function dayStart(value: string): Date | null {
  if (!DATE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);
  // A month or a day that rolled over (month 13, 30 February) is not that date.
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? date
    : null;
}

/** The received-at bounds of the range choice: `from` inclusive, `to` exclusive (the end of a custom day is the start of the next). */
export function rangeBounds(f: InboxFilters, now: Date): { from?: string; to?: string } {
  switch (f.range) {
    case 'all':
      return {};
    case 'day':
      return { from: new Date(now.getTime() - DAY_MS).toISOString() };
    case 'week':
      return { from: new Date(now.getTime() - 7 * DAY_MS).toISOString() };
    case 'month':
      return { from: new Date(now.getTime() - 30 * DAY_MS).toISOString() };
    case 'custom': {
      const from = dayStart(f.from);
      const toDay = dayStart(f.to);
      const to = toDay ? new Date(toDay.getTime() + DAY_MS) : null;
      return {
        ...(from ? { from: from.toISOString() } : {}),
        ...(to ? { to: to.toISOString() } : {}),
      };
    }
  }
}

/** A custom range whose end is before its start finds nothing: the screen says so instead of showing an empty list. */
export function rangeProblem(f: InboxFilters): 'order' | null {
  if (f.range !== 'custom') return null;
  const from = dayStart(f.from);
  const to = dayStart(f.to);
  return from && to && to.getTime() < from.getTime() ? 'order' : null;
}

/** The query string parameters for the list and for the counts (the counts have no status, reason or text of their own). */
export function inboxQuery(f: InboxFilters, now: Date): Record<string, string | undefined> {
  const bounds = rangeBounds(f, now);
  return {
    status: f.status === 'all' ? undefined : (f.status as LeadInboxStatusFilter),
    sourceId: f.sourceId || undefined,
    reason: f.reason || undefined,
    isTest: f.tests === 'only' ? 'true' : f.tests === 'hide' ? 'false' : undefined,
    from: bounds.from,
    to: bounds.to,
    q: f.q.trim() || undefined,
  };
}

export function summaryQuery(f: InboxFilters, now: Date): Record<string, string | undefined> {
  const { sourceId, isTest, from, to } = inboxQuery(f, now);
  return { sourceId, isTest, from, to };
}

/** A stable key for the cache: the filters that matter, without the clock (a "last 24 hours" range must not refetch every second). */
export const filterKey = (f: InboxFilters): string => JSON.stringify(f);

export const isDefaultFilters = (f: InboxFilters): boolean =>
  filterKey(f) === filterKey(DEFAULT_INBOX_FILTERS);

/** The chip a status count belongs to. */
export function chipCount(
  chip: InboxChip,
  s: { counts: Record<string, number>; attention: number; total: number },
): number {
  if (chip === 'all') return s.total;
  if (chip === 'attention') return s.attention;
  return s.counts[chip] ?? 0;
}

export const STATUS_KEYS: readonly LeadEventStatus[] = LEAD_EVENT_STATUSES;

// --- selection and bulk retry ------------------------------------------------------------------------------------------------------

export const MAX_BULK = 100;

/** Only a lead that can be retried can be selected: a row that cannot has no checkbox. */
export const selectableIds = (items: readonly LeadInboxItem[]): string[] =>
  items.filter((i) => i.retryable).map((i) => i.id);

export function toggleId(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/** Selection never outlives its rows: what a new filter or a fresh page no longer shows (or no longer lets retry) is dropped. */
export function prune(selected: readonly string[], items: readonly LeadInboxItem[]): string[] {
  const ok = new Set(selectableIds(items));
  return selected.filter((id) => ok.has(id));
}

/** Up to the bulk limit, in the order shown. */
export const withinLimit = (ids: readonly string[]): string[] => ids.slice(0, MAX_BULK);

export interface RetrySummary {
  retried: number;
  /** Counts of the outcomes that were not a retry, by outcome. */
  skipped: Record<string, number>;
  /** Of the leads retried, how many ended `created` or `updated`, and how many still wait. */
  fixed: number;
  stillWaiting: number;
}

export function retrySummary(r: RetrySummary | RetryLeadInboxResponse): RetrySummary {
  if (!('results' in r)) return r;
  const skipped: Record<string, number> = {};
  let fixed = 0;
  let stillWaiting = 0;
  for (const x of r.results) {
    if (x.outcome !== 'retried') skipped[x.outcome] = (skipped[x.outcome] ?? 0) + 1;
    else if (x.status === 'created' || x.status === 'updated') fixed += 1;
    else if (x.status === 'needs_review' || x.status === 'failed') stillWaiting += 1;
  }
  return { retried: r.retried, skipped, fixed, stillWaiting };
}

// --- sync and backfill -------------------------------------------------------------------------------------------------------------

export const isOpenRun = (r: Pick<LeadSyncRun, 'status'>): boolean =>
  r.status === 'queued' || r.status === 'running';

export const RUN_TONE: Record<LeadSyncRun['status'], Tone> = {
  queued: 'neutral',
  running: 'neutral',
  done: 'success',
  partial: 'warning',
  failed: 'danger',
};

/** How far a run is, 0 to 100. A sync has one step, a backfill as many windows as it expects. */
export function runPercent(
  r: Pick<LeadSyncRun, 'status' | 'windowsDone' | 'windowsTotal'>,
): number {
  if (r.status === 'done') return 100;
  if (r.status === 'queued' || r.windowsTotal <= 0) return 0;
  return Math.min(99, Math.round((r.windowsDone / r.windowsTotal) * 100));
}

export const RUN_ERROR_KEYS = [
  'too_soon',
  'not_now',
  'provider_error',
  'credentials_refused',
  'interrupted',
  'internal_error',
  'incomplete',
  'not_supported',
  'not_active',
  'range_too_old',
  'range_invalid',
] as const;
const RUN_ERROR_SET: ReadonlySet<string> = new Set(RUN_ERROR_KEYS);
/** A code this build knows is translated; any other is not shown as a code. */
export const knownRunError = (code: string | null): string | null =>
  code !== null && RUN_ERROR_SET.has(code) ? code : null;

/** The runs that are open, so the screen keeps asking for progress only while there is some. */
export const anyOpen = (runs: readonly Pick<LeadSyncRun, 'status'>[]): boolean =>
  runs.some(isOpenRun);

// --- backfill form ------------------------------------------------------------------------------------------------------------------

export const BACKFILL_MAX_DAYS = 90;

export interface BackfillDraft {
  from: string;
  to: string;
  /** Source uuids ticked. */
  sourceIds: string[];
}

export type BackfillProblem =
  'fromRequired' | 'toRequired' | 'order' | 'future' | 'tooWide' | 'noSource';

/** What is wrong with the form, in the order the person fills it. `now` is the person's own clock. */
export function backfillProblems(d: BackfillDraft, now: Date): BackfillProblem | null {
  const from = dayStart(d.from);
  const toDay = dayStart(d.to);
  if (!from) return 'fromRequired';
  if (!toDay) return 'toRequired';
  const to = new Date(toDay.getTime() + DAY_MS);
  if (to.getTime() <= from.getTime()) return 'order';
  if (from.getTime() > now.getTime()) return 'future';
  if (to.getTime() - from.getTime() > BACKFILL_MAX_DAYS * DAY_MS) return 'tooWide';
  if (d.sourceIds.length === 0) return 'noSource';
  return null;
}

/** The request: the days chosen, to the end of the last one, but never into the future. */
export function backfillBody(
  d: BackfillDraft,
  now: Date,
): { from: string; to: string; sourceIds: string[] } {
  const from = dayStart(d.from)!;
  const end = new Date(dayStart(d.to)!.getTime() + DAY_MS);
  const to = end.getTime() > now.getTime() ? now : end;
  return { from: from.toISOString(), to: to.toISOString(), sourceIds: d.sourceIds };
}
