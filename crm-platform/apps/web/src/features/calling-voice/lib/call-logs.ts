import {
  CALL_LOG_DEFAULT_RANGE,
  CALL_LOG_DIRECTIONS,
  CALL_LOG_RANGES,
  CALL_LOG_STATUSES,
  type CallAnalyticsQuery,
  type CallLogDirection,
  type CallLogListQuery,
  type CallLogRange,
  type CallLogStatus,
} from '@crm/contracts';

/** Pure helpers of the call log screens: the filters in the address bar, the words and numbers drawn on the page. */

// --- filters in the URL -----------------------------------------------------------------------------------------------

/** What the address bar says about the list (and about the analytics, which uses the range and the number). */
export interface LogParams {
  range: CallLogRange;
  /** First and last day of a custom range (YYYY-MM-DD); when either is set the preset range is ignored. */
  from?: string;
  to?: string;
  status?: CallLogStatus;
  direction?: CallLogDirection;
  numberId?: string;
  agentId?: string;
  q?: string;
  page: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneOf = <T extends string>(list: readonly T[], v: string | null): T | undefined =>
  v !== null && (list as readonly string[]).includes(v) ? (v as T) : undefined;

interface Params {
  get(name: string): string | null;
}

/** Reads the filters, ignoring anything that is not valid (a hand-edited address never breaks the page). */
export function parseLogParams(sp: Params): LogParams {
  const from = sp.get('from');
  const to = sp.get('to');
  const number = sp.get('numberId');
  const agent = sp.get('agentId');
  const page = Number(sp.get('page'));
  const q = (sp.get('q') ?? '').trim().slice(0, 80);
  return {
    range: oneOf(CALL_LOG_RANGES, sp.get('range')) ?? CALL_LOG_DEFAULT_RANGE,
    from: from && DAY.test(from) ? from : undefined,
    to: to && DAY.test(to) ? to : undefined,
    status: oneOf(CALL_LOG_STATUSES, sp.get('status')),
    direction: oneOf(CALL_LOG_DIRECTIONS, sp.get('direction')),
    numberId: number && UUID.test(number) ? number : undefined,
    agentId: agent && UUID.test(agent) ? agent : undefined,
    q: q || undefined,
    page: Number.isInteger(page) && page > 1 ? Math.min(page, 100000) : 1,
  };
}

/** The query string for a set of filters: what is at its default is left out, so the plain page has a plain address. */
export function logSearch(p: Partial<LogParams>): string {
  const sp = new URLSearchParams();
  const custom = Boolean(p.from || p.to);
  if (custom) {
    if (p.from) sp.set('from', p.from);
    if (p.to) sp.set('to', p.to);
  } else if (p.range && p.range !== CALL_LOG_DEFAULT_RANGE) sp.set('range', p.range);
  if (p.status) sp.set('status', p.status);
  if (p.direction) sp.set('direction', p.direction);
  if (p.numberId) sp.set('numberId', p.numberId);
  if (p.agentId) sp.set('agentId', p.agentId);
  if (p.q?.trim()) sp.set('q', p.q.trim());
  if (p.page && p.page > 1) sp.set('page', String(p.page));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** The browser's time zone, so "today" and the hours of the heat map are the person's own. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function toListQuery(p: LogParams, tz: string): Partial<CallLogListQuery> {
  const custom = Boolean(p.from || p.to);
  return {
    range: custom ? undefined : p.range,
    from: p.from,
    to: p.to,
    tz: custom ? tz : undefined,
    status: p.status,
    direction: p.direction,
    numberId: p.numberId,
    agentId: p.agentId,
    q: p.q,
    page: p.page,
  };
}

export function toAnalyticsQuery(p: LogParams, tz: string): Partial<CallAnalyticsQuery> {
  const custom = Boolean(p.from || p.to);
  return {
    range: custom ? undefined : p.range,
    from: p.from,
    to: p.to,
    tz,
    numberId: p.numberId,
  };
}

/** Pages: the last page number for a total, never less than one. */
export const pageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

// --- numbers and words --------------------------------------------------------------------------------------------------

/** `M:SS`, the way Reference's list showed a duration (`sprintf('%d:%02d')`). A long call keeps counting minutes (`75:03`). */
export function durationText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A phone number from the digits Meta gave. */
export const phoneText = (digits: string | null | undefined): string => {
  const d = (digits ?? '').replace(/\D/g, '');
  return d ? `+${d}` : '';
};

export type StatusTone = 'success' | 'neutral' | 'warning' | 'danger';

export const STATUS_TONE: Record<CallLogStatus, StatusTone> = {
  completed: 'success',
  'in-progress': 'neutral',
  'no-answer': 'warning',
  declined: 'neutral',
  failed: 'danger',
};

/** The end reasons and failure causes that have words in the messages; any other is shown as it came. */
export const KNOWN_REASONS = [
  'COMPLETED',
  'REJECTED',
  'DECLINED',
  'BUSY',
  'NO_ANSWER',
  'MISSED',
  'CANCELLED',
  'FAILED',
  'NO_PERMISSION',
  'META_REFUSED',
] as const;
export const knownReason = (reason: string | null | undefined): string | null => {
  const r = (reason ?? '').toUpperCase();
  return (KNOWN_REASONS as readonly string[]).includes(r) ? r : null;
};

/** The ledger steps that have words in the messages. */
export const KNOWN_STEPS = [
  'dial_sent',
  'dial_failed',
  'connect',
  'pre_accept_sent',
  'accept_sent',
  'accept_failed',
  'reject_sent',
  'terminate_sent',
  'terminate',
  'recording_stored',
] as const;
export const knownStep = (type: string): string | null =>
  (KNOWN_STEPS as readonly string[]).includes(type) ? type : null;

// --- analytics drawing --------------------------------------------------------------------------------------------------

/** How dark a heat-map cell is, 0 (no calls) to 4 (the busiest hour). */
export function heatLevel(calls: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (calls <= 0 || max <= 0) return 0;
  const share = calls / max;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;
  return 1;
}

/** A 7 x 24 grid of call counts, weekday-major (0 = Sunday); `max` is the busiest cell. */
export function heatGrid(cells: ReadonlyArray<{ weekday: number; hour: number; calls: number }>): {
  grid: number[][];
  max: number;
} {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  let max = 0;
  for (const c of cells) {
    if (c.weekday < 0 || c.weekday > 6 || c.hour < 0 || c.hour > 23) continue;
    grid[c.weekday]![c.hour] = c.calls;
    max = Math.max(max, c.calls);
  }
  return { grid, max };
}

/** Bar heights (0 to 1) for a series, against the tallest day; an all-empty series is all zeros. */
export function barHeights(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max === 0 ? 0 : v / max));
}

/** `62%`-style text for a share between 0 and 1. */
export const percentText = (share: number): string =>
  `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
