import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNS_STATE,
  addToSelection,
  dayLabel,
  detailPairs,
  durationParts,
  errorKey,
  failureGroups,
  flattenPages,
  flowRate,
  isLive,
  nextCursor,
  parseDays,
  parseRunsState,
  percent,
  reasonKind,
  runTone,
  runsQuery,
  runsStateToSearch,
  secondsBetween,
  toggleId,
} from './model';

const A = '11111111-1111-4111-8111-111111111111';

describe('status helpers', () => {
  it('knows which runs are live and their tone', () => {
    expect(isLive('waiting')).toBe(true);
    expect(isLive('halted')).toBe(true);
    expect(isLive('completed')).toBe(false);
    expect(isLive('cancelled')).toBe(false);
    expect(runTone('failed')).toBe('danger');
    expect(runTone('sleeping')).toBe('warning');
  });
});

describe('durations', () => {
  it('follows the minute, hour and day steps', () => {
    expect(durationParts(null)).toBeNull();
    expect(durationParts(-5)).toEqual([['s', 0]]);
    expect(durationParts(59)).toEqual([['s', 59]]);
    expect(durationParts(600)).toEqual([['m', 10]]);
    expect(durationParts(3600)).toEqual([['h', 1]]);
    expect(durationParts(3600 + 5 * 60 + 9)).toEqual([
      ['h', 1],
      ['m', 5],
    ]);
    expect(durationParts(86400 * 2 + 3600 * 4)).toEqual([
      ['d', 2],
      ['h', 4],
    ]);
    expect(durationParts(86400)).toEqual([['d', 1]]);
  });
  it('measures between two times, and to now when still open', () => {
    expect(secondsBetween('2026-10-01T10:00:00Z', '2026-10-01T10:01:30Z')).toBe(90);
    expect(secondsBetween('2026-10-01T10:00:00Z', null, Date.parse('2026-10-01T10:00:10Z'))).toBe(
      10,
    );
    expect(secondsBetween('nope', null)).toBeNull();
    expect(secondsBetween('2026-10-01T10:00:10Z', '2026-10-01T10:00:00Z')).toBe(0);
  });
  it('formats a rate and keeps null', () => {
    expect(percent(0.625)).toBe('62.5%');
    expect(percent(1)).toBe('100%');
    expect(percent(0)).toBe('0%');
    expect(percent(null)).toBeNull();
  });
});

describe('reasons and errors', () => {
  it('classifies the reason text', () => {
    expect(reasonKind(null)).toBe('unknown');
    expect(reasonKind('Unknown')).toBe('unknown');
    expect(
      reasonKind('Node n3 ran more than 20 times: its branch loops back without an exit'),
    ).toBe('loop');
    expect(reasonKind('paused')).toBe('paused');
    expect(reasonKind('No connected sender')).toBe('other');
  });
  it('maps problem codes to message keys and leaves the rest alone', () => {
    expect(errorKey('FLR_FLOW_INACTIVE')).toBe('flowInactive');
    expect(errorKey('FLR_RUN_STATE_CONFLICT')).toBe('runStateConflict');
    expect(errorKey('SOMETHING_ELSE')).toBeNull();
  });
  it('shortens step notes', () => {
    expect(detailPairs({ a: 'x', b: null, c: '', d: { n: 1 } })).toEqual([
      ['a', 'x'],
      ['d', '{"n":1}'],
    ]);
    expect(detailPairs({ long: 'y'.repeat(300) }, 10)[0]![1]).toHaveLength(10);
  });
});

describe('runs filters in the address', () => {
  it('round-trips and drops bad values', () => {
    const s = parseRunsState(new URLSearchParams(`status=failed&source=keyword&flowId=${A}`));
    expect(s).toEqual({ status: 'failed', source: 'keyword', flowId: A });
    expect(runsStateToSearch(s)).toBe(`?status=failed&source=keyword&flowId=${A}`);
    expect(parseRunsState(new URLSearchParams('status=nope&source=x&flowId=12'))).toEqual(
      DEFAULT_RUNS_STATE,
    );
    expect(runsStateToSearch(DEFAULT_RUNS_STATE)).toBe('');
  });
  it('builds the API query', () => {
    expect(runsQuery(DEFAULT_RUNS_STATE)).toEqual({
      status: undefined,
      source: undefined,
      flowId: undefined,
      limit: 25,
      cursor: undefined,
    });
    expect(runsQuery({ ...DEFAULT_RUNS_STATE, status: 'waiting' }, 'c1')).toMatchObject({
      status: 'waiting',
      cursor: 'c1',
    });
  });
  it('reads the days selector', () => {
    expect(parseDays('90')).toBe(90);
    expect(parseDays('5')).toBe(30);
    expect(parseDays(null)).toBe(30);
  });
});

describe('cursor paging', () => {
  it('ends on a null or empty cursor', () => {
    expect(nextCursor({ nextCursor: 'abc' })).toBe('abc');
    expect(nextCursor({ nextCursor: null })).toBeUndefined();
    expect(nextCursor({ nextCursor: '' })).toBeUndefined();
  });
  it('keeps a row once when pages overlap', () => {
    expect(
      flattenPages([
        { items: [{ id: 'a' }, { id: 'b' }] },
        { items: [{ id: 'b' }, { id: 'c' }] },
      ]).map((x) => x.id),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('enrollment selection', () => {
  it('respects the cap and reports what did not fit', () => {
    expect(addToSelection(['a'], ['a', 'b', 'c'], 2)).toEqual({ ids: ['a', 'b'], dropped: 1 });
    expect(addToSelection([], ['a', 'a'], 5)).toEqual({ ids: ['a'], dropped: 0 });
  });
  it('toggles an id and stops at 500', () => {
    expect(toggleId(['a'], 'a')).toEqual([]);
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    const full = Array.from({ length: 500 }, (_, i) => `id${i}`);
    expect(toggleId(full, 'x')).toBe(full);
  });
  it('groups failed contacts by reason', () => {
    const r = {
      enrolled: 1,
      alreadyEnrolled: 0,
      failed: 3,
      results: [
        { contactId: A, outcome: 'started' as const, reason: null },
        { contactId: A, outcome: 'failed' as const, reason: 'No number' },
        { contactId: A, outcome: 'failed' as const, reason: 'No number' },
        { contactId: A, outcome: 'failed' as const, reason: null },
      ],
    };
    expect(failureGroups(r)).toEqual([
      { reason: 'No number', count: 2 },
      { reason: '', count: 1 },
    ]);
  });
});

describe('analytics helpers', () => {
  it('labels days and rates flows over finished runs', () => {
    expect(dayLabel('2026-10-03')).toBe('10-03');
    expect(dayLabel('week 1')).toBe('week 1');
    expect(flowRate({ completed: 3, failed: 1 })).toBe(0.75);
    expect(flowRate({ completed: 0, failed: 0 })).toBeNull();
  });
});
