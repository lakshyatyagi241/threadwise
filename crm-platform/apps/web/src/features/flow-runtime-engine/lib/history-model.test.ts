import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANALYTICS_STATE,
  MAX_BATCH,
  analyticsStateToSearch,
  clampBatch,
  errorsQuery,
  failedRowsQuery,
  fillBatch,
  historyFiltered,
  historyQuery,
  outcomeTone,
  parseAnalyticsState,
  retriesQuery,
  retryManyTone,
  retryOneMessage,
  toggleBatch,
} from './history-model';

const FLOW = '3f2a1c9e-7b4d-4e21-9a6f-0c1d2e3f4a5b';
const parse = (q: string) => parseAnalyticsState(new URLSearchParams(q));

describe('analytics URL state', () => {
  it('defaults when the address is empty and ignores values it does not know', () => {
    expect(parse('')).toEqual(DEFAULT_ANALYTICS_STATE);
    expect(parse('tab=nope&range=5&flowId=abc&status=x&from=yesterday&outcome=weird')).toEqual(
      DEFAULT_ANALYTICS_STATE,
    );
  });

  it('round-trips and writes only what differs', () => {
    const s = parse(
      `tab=history&range=all&flowId=${FLOW}&status=failed&q=timeout&from=2026-09-01&to=2026-09-30`,
    );
    expect(s).toMatchObject({
      tab: 'history',
      range: 'all',
      flowId: FLOW,
      status: 'failed',
      q: 'timeout',
    });
    expect(parse(analyticsStateToSearch(s).slice(1))).toEqual(s);
    expect(analyticsStateToSearch(DEFAULT_ANALYTICS_STATE)).toBe('');
    expect(analyticsStateToSearch({ ...DEFAULT_ANALYTICS_STATE, range: '7' })).toBe('?range=7');
  });
});

describe('queries', () => {
  it('lets custom dates beat the period chip', () => {
    const s = { ...DEFAULT_ANALYTICS_STATE, range: '7' as const };
    expect(historyQuery(s)).toMatchObject({ days: 7, limit: 25 });
    expect(historyQuery({ ...s, from: '2026-09-01' })).toMatchObject({
      dateFrom: '2026-09-01',
      dateTo: undefined,
    });
    expect(historyQuery({ ...s, from: '2026-09-01' }).days).toBeUndefined();
  });

  it('all time sends no days, status and outcome "all" send nothing, a blank search is dropped', () => {
    const s = { ...DEFAULT_ANALYTICS_STATE, range: 'all' as const, q: '   ' };
    expect(historyQuery(s)).toMatchObject({ days: undefined, status: undefined, q: undefined });
    expect(retriesQuery(s, 'c1')).toMatchObject({
      outcome: undefined,
      cursor: 'c1',
      days: undefined,
    });
    expect(retriesQuery({ ...s, outcome: 'failed' })).toMatchObject({ outcome: 'failed' });
  });

  it('errors and retry records follow the period and the flow only', () => {
    const s = { ...DEFAULT_ANALYTICS_STATE, flowId: FLOW, from: '2026-09-01', q: 'x' };
    expect(errorsQuery(s)).toEqual({ flowId: FLOW, days: 30 });
    expect(failedRowsQuery(s)).toMatchObject({ flowId: FLOW, status: 'failed', days: 30 });
  });

  it('knows when the history is narrowed', () => {
    expect(historyFiltered(DEFAULT_ANALYTICS_STATE)).toBe(false);
    expect(historyFiltered({ ...DEFAULT_ANALYTICS_STATE, q: ' ' })).toBe(false);
    expect(historyFiltered({ ...DEFAULT_ANALYTICS_STATE, status: 'failed' })).toBe(true);
    expect(historyFiltered({ ...DEFAULT_ANALYTICS_STATE, to: '2026-09-30' })).toBe(true);
  });
});

describe('retry batches', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

  it('toggles an id and refuses one past the cap', () => {
    expect(toggleBatch([], 'a')).toEqual({ ids: ['a'], capped: false });
    expect(toggleBatch(['a', 'b'], 'a')).toEqual({ ids: ['b'], capped: false });
    const full = ids(MAX_BATCH);
    expect(toggleBatch(full, 'extra')).toEqual({ ids: full, capped: true });
    expect(toggleBatch(full, 'id-3').ids).toHaveLength(MAX_BATCH - 1);
  });

  it('selects a page up to the cap and says when some did not fit', () => {
    const r = fillBatch(ids(MAX_BATCH - 2), ['x', 'y', 'z', 'id-0']);
    expect(r.ids).toHaveLength(MAX_BATCH);
    expect(r.capped).toBe(true);
    expect(fillBatch([], ['x', 'y'])).toEqual({ ids: ['x', 'y'], capped: false });
  });

  it('cuts a group to one batch without duplicates', () => {
    expect(clampBatch(['a', 'a', 'b'])).toEqual({ ids: ['a', 'b'], truncated: false });
    const r = clampBatch(ids(MAX_BATCH + 7));
    expect(r.ids).toHaveLength(MAX_BATCH);
    expect(r.truncated).toBe(true);
  });
});

describe('retry messages', () => {
  const one = (
    outcome: 'queued' | 'succeeded' | 'failed' | 'skipped',
    reason: string | null = null,
  ) => ({
    retried: 0,
    skipped: 0,
    outcome,
    reason,
  });
  it('says started, completed or failed again with the reason', () => {
    expect(retryOneMessage(one('queued'))).toEqual({
      key: 'started',
      tone: 'success',
      reason: null,
    });
    expect(retryOneMessage(one('succeeded')).key).toBe('completed');
    expect(retryOneMessage(one('failed', ' No sender '))).toEqual({
      key: 'failedAgain',
      tone: 'danger',
      reason: 'No sender',
    });
    expect(retryOneMessage(one('failed', '  ')).reason).toBeNull();
  });

  it('a bulk result is red only when nothing started and something failed', () => {
    const base = {
      requested: 3,
      attempted: 3,
      queued: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };
    expect(retryManyTone({ ...base, failed: 3 })).toBe('danger');
    expect(retryManyTone({ ...base, queued: 1, failed: 2 })).toBe('success');
    expect(retryManyTone({ ...base, skipped: 3 })).toBe('success');
  });
});

describe('outcomeTone', () => {
  it('colours each retry outcome', () => {
    expect(outcomeTone('queued')).toBe('warning');
    expect(outcomeTone('succeeded')).toBe('success');
    expect(outcomeTone('failed')).toBe('danger');
    expect(outcomeTone('skipped')).toBe('neutral');
  });
});
