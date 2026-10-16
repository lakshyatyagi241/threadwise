import { describe, expect, it } from 'vitest';
import type { LeadInboxItem, LeadSyncRun } from '@crm/contracts';
import { ID, event } from '../test-fixtures';
import {
  ALL_INBOX_FILTERS,
  BACKFILL_MAX_DAYS,
  DEFAULT_INBOX_FILTERS,
  MAX_BULK,
  anyOpen,
  backfillBody,
  backfillProblems,
  chipCount,
  dayStart,
  filterKey,
  inboxQuery,
  isDefaultFilters,
  isOpenRun,
  knownRunError,
  prune,
  rangeBounds,
  rangeProblem,
  retrySummary,
  runPercent,
  selectableIds,
  summaryQuery,
  toggleId,
  withinLimit,
  type InboxFilters,
} from './inbox-view';

const NOW = new Date(2026, 9, 16, 15, 30, 0); // 16 October 2026, 15:30 in the person's own zone

const item = (n: number, patch: Partial<LeadInboxItem> = {}): LeadInboxItem => ({
  ...event({ id: ID(100 + n), externalId: `lead-${n}` }),
  sourceName: 'Zapier',
  sourceKind: 'webhook',
  sourceStatus: 'active',
  retryable: false,
  ...patch,
});

const run = (patch: Partial<LeadSyncRun> = {}): LeadSyncRun => ({
  id: ID(900),
  sourceId: ID(1),
  sourceName: 'Portal',
  kind: 'backfill',
  status: 'running',
  rangeFrom: '2026-10-01T00:00:00.000Z',
  rangeTo: '2026-10-05T00:00:00.000Z',
  fetched: 0,
  accepted: 0,
  duplicates: 0,
  failed: 0,
  windowsDone: 0,
  windowsTotal: 0,
  error: null,
  requestedAt: '2026-10-16T10:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  ...patch,
});

describe('the filters', () => {
  it('open on the leads that wait, with test leads hidden', () => {
    expect(DEFAULT_INBOX_FILTERS).toMatchObject({
      status: 'attention',
      tests: 'hide',
      range: 'all',
    });
    expect(isDefaultFilters(DEFAULT_INBOX_FILTERS)).toBe(true);
    expect(isDefaultFilters(ALL_INBOX_FILTERS)).toBe(false);
  });

  it('become the API query: only what is set, status all as no status, tests as a boolean', () => {
    expect(inboxQuery(DEFAULT_INBOX_FILTERS, NOW)).toEqual({
      status: 'attention',
      sourceId: undefined,
      reason: undefined,
      isTest: 'false',
      from: undefined,
      to: undefined,
      q: undefined,
    });
    const f: InboxFilters = {
      ...ALL_INBOX_FILTERS,
      sourceId: ID(1),
      reason: 'invalid_phone',
      tests: 'only',
      q: '  lead-9 ',
    };
    expect(inboxQuery(f, NOW)).toMatchObject({
      status: undefined,
      sourceId: ID(1),
      reason: 'invalid_phone',
      isTest: 'true',
      q: 'lead-9',
    });
  });

  it('the counts follow the same window and source but have no status, reason or text of their own', () => {
    const f: InboxFilters = {
      ...DEFAULT_INBOX_FILTERS,
      sourceId: ID(2),
      reason: 'x',
      q: 'a',
      range: 'week',
    };
    const s = summaryQuery(f, NOW);
    expect(Object.keys(s).sort()).toEqual(['from', 'isTest', 'sourceId', 'to']);
    expect(s.sourceId).toBe(ID(2));
    expect(s.from).toBe(new Date(NOW.getTime() - 7 * 86_400_000).toISOString());
  });

  it('turns a range choice into received-at bounds, a custom day to the end of that day', () => {
    expect(rangeBounds(ALL_INBOX_FILTERS, NOW)).toEqual({});
    expect(rangeBounds({ ...ALL_INBOX_FILTERS, range: 'day' }, NOW).from).toBe(
      new Date(NOW.getTime() - 86_400_000).toISOString(),
    );
    const custom = rangeBounds(
      { ...ALL_INBOX_FILTERS, range: 'custom', from: '2026-10-01', to: '2026-10-03' },
      NOW,
    );
    expect(custom.from).toBe(new Date(2026, 9, 1).toISOString());
    // the last day is included: the bound is the start of the next one
    expect(custom.to).toBe(new Date(2026, 9, 4).toISOString());
    expect(rangeBounds({ ...ALL_INBOX_FILTERS, range: 'custom', from: '', to: '' }, NOW)).toEqual(
      {},
    );
    expect(
      rangeBounds({ ...ALL_INBOX_FILTERS, range: 'custom', from: 'soon', to: '2026-02-31' }, NOW),
    ).toEqual({});
  });

  it('a custom range backwards is a problem, not an empty list', () => {
    const bad = {
      ...ALL_INBOX_FILTERS,
      range: 'custom' as const,
      from: '2026-10-05',
      to: '2026-10-01',
    };
    expect(rangeProblem(bad)).toBe('order');
    expect(rangeProblem({ ...bad, to: '2026-10-05' })).toBeNull();
    expect(rangeProblem(ALL_INBOX_FILTERS)).toBeNull();
  });

  it('keys the cache on the filters, not on the clock', () => {
    expect(filterKey(DEFAULT_INBOX_FILTERS)).toBe(filterKey({ ...DEFAULT_INBOX_FILTERS }));
    expect(filterKey(DEFAULT_INBOX_FILTERS)).not.toBe(filterKey(ALL_INBOX_FILTERS));
  });

  it('reads the dates a person typed and nothing else', () => {
    expect(dayStart('2026-10-16')?.getTime()).toBe(new Date(2026, 9, 16).getTime());
    for (const bad of ['', '16/10/2026', '2026-13-01', '2026-02-30', 'tomorrow']) {
      expect(dayStart(bad), bad).toBeNull();
    }
  });

  it('shows each chip its own count, the attention chip the two that wait', () => {
    const s = { counts: { created: 5, needs_review: 2, failed: 1 }, attention: 3, total: 8 };
    expect(chipCount('all', s)).toBe(8);
    expect(chipCount('attention', s)).toBe(3);
    expect(chipCount('created', s)).toBe(5);
    expect(chipCount('duplicate', s)).toBe(0);
  });
});

describe('selecting leads to retry', () => {
  const items = [item(1, { retryable: true }), item(2), item(3, { retryable: true })];

  it('only a lead that can be retried can be selected', () => {
    expect(selectableIds(items)).toEqual([ID(101), ID(103)]);
  });

  it('toggles a lead in and out, keeping the order of the clicks', () => {
    expect(toggleId([], 'a')).toEqual(['a']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('drops what is no longer shown or no longer retryable', () => {
    expect(prune([ID(101), ID(102), ID(999)], items)).toEqual([ID(101)]);
    expect(prune([ID(101)], [item(1, { retryable: false })])).toEqual([]);
  });

  it('is limited to what one request takes', () => {
    const many = Array.from({ length: MAX_BULK + 20 }, (_v, i) => `id-${i}`);
    expect(withinLimit(many)).toHaveLength(MAX_BULK);
    expect(withinLimit(many)[0]).toBe('id-0');
  });
});

describe('what a bulk retry did', () => {
  it('counts the leads that became contacts, those that still wait and why the others were not retried', () => {
    const s = retrySummary({
      results: [
        { id: 'a', outcome: 'retried', status: 'created' },
        { id: 'b', outcome: 'retried', status: 'updated' },
        { id: 'c', outcome: 'retried', status: 'needs_review' },
        { id: 'd', outcome: 'not_retryable', status: null },
        { id: 'e', outcome: 'not_retryable', status: null },
        { id: 'f', outcome: 'payload_purged', status: null },
      ],
      retried: 3,
      skipped: 3,
    });
    expect(s).toEqual({
      retried: 3,
      fixed: 2,
      stillWaiting: 1,
      skipped: { not_retryable: 2, payload_purged: 1 },
    });
  });
});

describe('pulling', () => {
  it('knows which runs are open', () => {
    expect(isOpenRun(run({ status: 'queued' }))).toBe(true);
    expect(isOpenRun(run({ status: 'running' }))).toBe(true);
    for (const s of ['done', 'partial', 'failed'] as const)
      expect(isOpenRun(run({ status: s })), s).toBe(false);
    expect(anyOpen([run({ status: 'done' }), run({ status: 'running' })])).toBe(true);
    expect(anyOpen([run({ status: 'done' })])).toBe(false);
    expect(anyOpen([])).toBe(false);
  });

  it('shows progress as windows done of windows expected, never 100 before it is done', () => {
    expect(runPercent(run({ status: 'queued', windowsDone: 0, windowsTotal: 4 }))).toBe(0);
    expect(runPercent(run({ status: 'running', windowsDone: 1, windowsTotal: 4 }))).toBe(25);
    expect(runPercent(run({ status: 'running', windowsDone: 4, windowsTotal: 4 }))).toBe(99);
    expect(runPercent(run({ status: 'running', windowsDone: 0, windowsTotal: 0 }))).toBe(0);
    expect(runPercent(run({ status: 'done', windowsDone: 0, windowsTotal: 0 }))).toBe(100);
  });

  it('translates the error codes it knows and shows no other code', () => {
    expect(knownRunError('credentials_refused')).toBe('credentials_refused');
    expect(knownRunError('whatever_the_portal_said')).toBeNull();
    expect(knownRunError(null)).toBeNull();
  });
});

describe('the backfill form', () => {
  const draft = { from: '2026-10-10', to: '2026-10-12', sourceIds: [ID(1)] };

  it('is fine with a past range and a source', () => {
    expect(backfillProblems(draft, NOW)).toBeNull();
  });

  it('says what is wrong, in the order the person fills it in', () => {
    expect(backfillProblems({ ...draft, from: '' }, NOW)).toBe('fromRequired');
    expect(backfillProblems({ ...draft, to: '' }, NOW)).toBe('toRequired');
    expect(backfillProblems({ ...draft, from: '2026-10-13' }, NOW)).toBe('order');
    expect(backfillProblems({ ...draft, from: '2026-10-20', to: '2026-10-21' }, NOW)).toBe(
      'future',
    );
    expect(backfillProblems({ ...draft, from: '2026-06-01', to: '2026-10-12' }, NOW)).toBe(
      'tooWide',
    );
    expect(backfillProblems({ ...draft, sourceIds: [] }, NOW)).toBe('noSource');
    expect(BACKFILL_MAX_DAYS).toBe(90);
  });

  it('asks from the start of the first day to the end of the last, never into the future', () => {
    const body = backfillBody(draft, NOW);
    expect(body.from).toBe(new Date(2026, 9, 10).toISOString());
    expect(body.to).toBe(new Date(2026, 9, 13).toISOString());
    expect(body.sourceIds).toEqual([ID(1)]);
    const today = backfillBody({ ...draft, from: '2026-10-15', to: '2026-10-16' }, NOW);
    expect(today.to).toBe(NOW.toISOString());
  });
});
