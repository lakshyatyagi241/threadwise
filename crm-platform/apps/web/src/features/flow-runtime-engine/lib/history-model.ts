/** The pure half of the analytics tabs (WD-FLR-053 to 058): URL state, the queries it makes, and the retry batch rules. */
import {
  FLOW_RETRY_MAX_BATCH,
  FLOW_RETRY_OUTCOMES,
  FLOW_SUBSCRIBER_STATUSES,
  type FlowRetryOutcome,
  type FlowSubscriberStatus,
  type RetryManyResult,
  type RetryOneResult,
} from '@crm/contracts';

export const RANGES = ['7', '30', '90', 'all'] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = '30';
export const TABS = ['overview', 'history', 'errors', 'retries'] as const;
export type Tab = (typeof TABS)[number];
export const TABLE_PAGE_SIZE = 25;
/** The server's own limits, shown on the bulk bar so the screen never promises more than the backend allows. */
export const MAX_BATCH = FLOW_RETRY_MAX_BATCH;

/** Days for the API: 0 is all time. */
export const rangeDays = (r: Range): number => (r === 'all' ? 0 : Number(r));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const oneOf = <T extends string>(list: readonly T[], v: string | null): T | null =>
  v && (list as readonly string[]).includes(v) ? (v as T) : null;

export interface AnalyticsState {
  tab: Tab;
  range: Range;
  flowId: string;
  /** The history table's own filters. */
  status: FlowSubscriberStatus | 'all';
  q: string;
  from: string;
  to: string;
  /** The retry records' outcome chip. */
  outcome: FlowRetryOutcome | 'all';
}

export const DEFAULT_ANALYTICS_STATE: AnalyticsState = {
  tab: 'overview',
  range: DEFAULT_RANGE,
  flowId: '',
  status: 'all',
  q: '',
  from: '',
  to: '',
  outcome: 'all',
};

export function parseAnalyticsState(search: URLSearchParams): AnalyticsState {
  const flowId = search.get('flowId') ?? '';
  const from = search.get('from') ?? '';
  const to = search.get('to') ?? '';
  return {
    tab: oneOf(TABS, search.get('tab')) ?? 'overview',
    range: oneOf(RANGES, search.get('range')) ?? DEFAULT_RANGE,
    flowId: UUID.test(flowId) ? flowId : '',
    status: oneOf(FLOW_SUBSCRIBER_STATUSES, search.get('status')) ?? 'all',
    q: (search.get('q') ?? '').slice(0, 120),
    from: DAY.test(from) ? from : '',
    to: DAY.test(to) ? to : '',
    outcome: oneOf(FLOW_RETRY_OUTCOMES, search.get('outcome')) ?? 'all',
  };
}

/** Only what differs from the default goes into the address. */
export function analyticsStateToSearch(s: AnalyticsState): string {
  const d = DEFAULT_ANALYTICS_STATE;
  const p = new URLSearchParams();
  if (s.tab !== d.tab) p.set('tab', s.tab);
  if (s.range !== d.range) p.set('range', s.range);
  if (s.flowId) p.set('flowId', s.flowId);
  if (s.status !== d.status) p.set('status', s.status);
  if (s.q) p.set('q', s.q);
  if (s.from) p.set('from', s.from);
  if (s.to) p.set('to', s.to);
  if (s.outcome !== d.outcome) p.set('outcome', s.outcome);
  const out = p.toString();
  return out ? `?${out}` : '';
}

export const historyQuery = (s: AnalyticsState, cursor?: string) => ({
  flowId: s.flowId || undefined,
  status: s.status === 'all' ? undefined : s.status,
  q: s.q.trim() || undefined,
  ...windowQuery(s),
  limit: TABLE_PAGE_SIZE,
  cursor,
});

/** The window of the history: custom dates beat the period chip, as in WaDesk. */
export const windowQuery = (s: AnalyticsState) =>
  s.from || s.to
    ? { dateFrom: s.from || undefined, dateTo: s.to || undefined }
    : { days: s.range === 'all' ? undefined : rangeDays(s.range) };

/** True when custom dates (not a period chip) set the window. */
export const isCustomRange = (s: AnalyticsState): boolean => s.from !== '' || s.to !== '';

/** The error logs and the retry records follow the period (chip or custom dates) and the flow. */
const periodOnly = (s: AnalyticsState) => ({
  flowId: s.flowId || undefined,
  ...windowQuery(s),
});
export const errorsQuery = (s: AnalyticsState) => periodOnly(s);
export const retriesQuery = (s: AnalyticsState, cursor?: string) => ({
  ...periodOnly(s),
  outcome: s.outcome === 'all' ? undefined : s.outcome,
  limit: TABLE_PAGE_SIZE,
  cursor,
});
/** The failed runs under the error groups: the same period and flow, failures only. */
export const failedRowsQuery = (s: AnalyticsState, cursor?: string) => ({
  ...periodOnly(s),
  status: 'failed' as const,
  limit: TABLE_PAGE_SIZE,
  cursor,
});

/** True when anything narrows the history beyond the period chip. */
export const historyFiltered = (s: AnalyticsState) =>
  s.status !== 'all' || s.q.trim() !== '' || s.from !== '' || s.to !== '' || s.flowId !== '';

// --- retry batches -----------------------------------------------------------------------------------------------------

/** Adds or removes one id of a selection; a full batch refuses another (`capped`), as WaDesk's does. */
export function toggleBatch(selected: string[], id: string, max = MAX_BATCH) {
  if (selected.includes(id)) return { ids: selected.filter((x) => x !== id), capped: false };
  if (selected.length >= max) return { ids: selected, capped: true };
  return { ids: [...selected, id], capped: false };
}

/** Selects every given id up to the cap; `capped` says some did not fit. */
export function fillBatch(selected: string[], add: string[], max = MAX_BATCH) {
  const ids = [...selected];
  let capped = false;
  for (const id of add) {
    if (ids.includes(id)) continue;
    if (ids.length >= max) capped = true;
    else ids.push(id);
  }
  return { ids, capped };
}

/** An id list cut to one batch; `truncated` says it was longer. */
export const clampBatch = (ids: string[], max = MAX_BATCH) => ({
  ids: [...new Set(ids)].slice(0, max),
  truncated: new Set(ids).size > max,
});

/** What to tell the operator after one retry: which sentence, and the engine's reason when it failed again. */
export function retryOneMessage(r: RetryOneResult): {
  key: 'started' | 'completed' | 'failedAgain';
  tone: 'success' | 'danger';
  reason: string | null;
} {
  if (r.outcome === 'failed')
    return { key: 'failedAgain', tone: 'danger', reason: r.reason?.trim() || null };
  if (r.outcome === 'succeeded') return { key: 'completed', tone: 'success', reason: null };
  return { key: 'started', tone: 'success', reason: null };
}

/** Badge tone of a retry outcome: re-started is in progress, completed is good, failed again is bad. */
export const outcomeTone = (o: FlowRetryOutcome): 'neutral' | 'success' | 'warning' | 'danger' =>
  o === 'succeeded'
    ? 'success'
    : o === 'failed'
      ? 'danger'
      : o === 'queued'
        ? 'warning'
        : 'neutral';

/** The tone of a bulk result: green unless nothing started and something failed. */
export const retryManyTone = (r: RetryManyResult): 'success' | 'danger' =>
  r.queued + r.succeeded === 0 && r.failed > 0 ? 'danger' : 'success';
