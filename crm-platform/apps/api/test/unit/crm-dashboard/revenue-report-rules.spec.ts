import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/common/errors/app-error';
import {
  addMonths,
  compareRows,
  daysInMonth,
  resolveRevenuePeriod,
  revenuePeriodOf,
} from '../../../src/modules/crm/revenue-report/revenue-report-rules';

const at = (
  range: Parameters<typeof resolveRevenuePeriod>[0],
  compare: 'previous' | 'lastYear' | 'none',
  today = '2026-10-15',
  custom = {},
) => resolveRevenuePeriod(range, compare, 'UTC', today, custom);

describe('resolveRevenuePeriod - the period', () => {
  it('month, quarter and year are that calendar period to date', () => {
    expect(at('month', 'none')).toMatchObject({
      fromDate: '2026-10-01',
      toDate: '2026-10-15',
      days: 15,
    });
    expect(at('quarter', 'none')).toMatchObject({ fromDate: '2026-10-01', toDate: '2026-10-15' });
    expect(at('quarter', 'none', '2026-08-20')).toMatchObject({
      fromDate: '2026-07-01',
      toDate: '2026-08-20',
    });
    expect(at('year', 'none')).toMatchObject({
      fromDate: '2026-01-01',
      toDate: '2026-10-15',
      days: 288,
    });
  });

  it('last month is the whole previous month, across a year end too', () => {
    expect(at('lastMonth', 'none')).toMatchObject({
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
      days: 30,
    });
    expect(at('lastMonth', 'none', '2027-01-09')).toMatchObject({
      fromDate: '2026-12-01',
      toDate: '2026-12-31',
    });
    expect(at('lastMonth', 'none', '2028-03-05')).toMatchObject({
      fromDate: '2028-02-01',
      toDate: '2028-02-29',
    });
  });

  it('30d and 90d end today and include it', () => {
    expect(at('30d', 'none')).toMatchObject({
      fromDate: '2026-09-16',
      toDate: '2026-10-15',
      days: 30,
    });
    expect(at('90d', 'none')).toMatchObject({ fromDate: '2026-07-18', days: 90 });
  });

  it('custom: a missing to is today, a future to is cut to today, a missing from is 29 days before to, from is never after to', () => {
    expect(at('custom', 'none', '2026-10-15', { from: '2026-10-01' })).toMatchObject({
      fromDate: '2026-10-01',
      toDate: '2026-10-15',
    });
    expect(
      at('custom', 'none', '2026-10-15', { from: '2026-10-01', to: '2027-02-01' }),
    ).toMatchObject({ toDate: '2026-10-15' });
    expect(at('custom', 'none', '2026-10-15', { to: '2026-10-10' })).toMatchObject({
      fromDate: '2026-09-11',
      toDate: '2026-10-10',
      days: 30,
    });
    expect(
      at('custom', 'none', '2026-10-15', { from: '2026-10-20', to: '2026-10-12' }),
    ).toMatchObject({ fromDate: '2026-10-12', toDate: '2026-10-12', days: 1 });
  });

  it('refuses more than 366 days', () => {
    expect(() =>
      at('custom', 'none', '2026-10-15', { from: '2025-01-01', to: '2026-10-10' }),
    ).toThrow(AppError);
    expect(at('custom', 'none', '2026-10-15', { from: '2025-10-15' }).days).toBe(366);
    expect(() => at('custom', 'none', '2026-10-15', { from: '2025-10-14' })).toThrow(
      /at most 366 days/,
    );
  });

  it('cuts the instants at local midnights of the viewer, across a daylight-saving change', () => {
    const p = resolveRevenuePeriod('custom', 'none', 'America/New_York', '2026-04-10', {
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(p.from.toISOString()).toBe('2026-03-01T05:00:00.000Z');
    expect(p.toExclusive.toISOString()).toBe('2026-04-01T04:00:00.000Z');
  });
});

describe('resolveRevenuePeriod - the comparison', () => {
  it('no comparison when none is asked for', () => {
    expect(at('month', 'none').compare).toBeNull();
  });

  it('month to date is set against the same stretch of the previous month', () => {
    const c = at('month', 'previous').compare!;
    expect([c.fromDate, c.toDate, c.mode]).toEqual(['2026-09-01', '2026-09-15', 'previous']);
    expect(c.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(c.toExclusive.toISOString()).toBe('2026-09-16T00:00:00.000Z');
  });

  it('the stretch is cut to the length of a shorter previous month (31 March against February)', () => {
    const c = at('month', 'previous', '2026-03-31').compare!;
    expect([c.fromDate, c.toDate]).toEqual(['2026-02-01', '2026-02-28']);
    const leap = at('month', 'previous', '2028-03-31').compare!;
    expect(leap.toDate).toBe('2028-02-29');
  });

  it('quarter to date against the same stretch of the previous quarter, year to date against last year', () => {
    expect(at('quarter', 'previous').compare).toMatchObject({
      fromDate: '2026-07-01',
      toDate: '2026-07-15',
    });
    expect(at('quarter', 'previous', '2026-03-31').compare).toMatchObject({
      fromDate: '2025-10-01',
      toDate: '2025-12-29',
    });
    // 90 days in Q1 2026 against the first 90 days of the 92 day Q4
    expect(at('year', 'previous').compare).toMatchObject({
      fromDate: '2025-01-01',
      toDate: '2025-10-15',
    });
    // a leap day in the current year is cut off the end of a 365 day year
    expect(at('year', 'previous', '2028-12-31').compare).toMatchObject({
      fromDate: '2027-01-01',
      toDate: '2027-12-31',
    });
  });

  it('last month against the month before it', () => {
    expect(at('lastMonth', 'previous').compare).toMatchObject({
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
    });
    expect(at('lastMonth', 'previous', '2026-03-10').compare).toMatchObject({
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
    });
  });

  it('a rolling window (30d, 90d, custom) is set against the window of the same length right before', () => {
    expect(at('30d', 'previous').compare).toMatchObject({
      fromDate: '2026-08-17',
      toDate: '2026-09-15',
    });
    expect(at('90d', 'previous').compare).toMatchObject({
      fromDate: '2026-04-19',
      toDate: '2026-07-17',
    });
    expect(
      at('custom', 'previous', '2026-10-15', { from: '2026-10-10', to: '2026-10-14' }).compare,
    ).toMatchObject({
      fromDate: '2026-10-05',
      toDate: '2026-10-09',
    });
  });

  it('last year is the same dates one year earlier; 29 February becomes 28 February', () => {
    expect(at('month', 'lastYear').compare).toMatchObject({
      fromDate: '2025-10-01',
      toDate: '2025-10-15',
      mode: 'lastYear',
    });
    expect(
      at('custom', 'lastYear', '2028-03-10', { from: '2028-02-29', to: '2028-03-02' }).compare,
    ).toMatchObject({
      fromDate: '2027-02-28',
      toDate: '2027-03-02',
    });
  });

  it('cuts the comparison instants in the viewer zone too', () => {
    const p = resolveRevenuePeriod('month', 'previous', 'Asia/Kolkata', '2026-10-15');
    expect(p.compare!.from.toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(p.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });
});

describe('revenuePeriodOf - a period an export fixed', () => {
  it('takes the dates as they are and cuts the instants again in the stored zone', () => {
    const p = revenuePeriodOf(
      {
        range: 'month',
        fromDate: '2026-10-01',
        toDate: '2026-10-15',
        compare: { mode: 'previous', fromDate: '2026-09-01', toDate: '2026-09-15' },
      },
      'Asia/Kolkata',
      '2026-10-20',
    );
    expect(p).toMatchObject({ range: 'month', days: 15, today: '2026-10-20' });
    expect(p.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(p.compare!.toExclusive.toISOString()).toBe('2026-09-15T18:30:00.000Z');
    expect(
      revenuePeriodOf(
        { range: 'custom', fromDate: '2026-10-01', toDate: '2026-10-01', compare: null },
        'UTC',
        '2026-10-02',
      ).compare,
    ).toBeNull();
  });
});

describe('calendar helpers', () => {
  it('addMonths keeps the day and cuts it to the length of the target month', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2028-02-29', -12)).toBe('2027-02-28');
  });

  it('daysInMonth knows leap years', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('compareRows', () => {
  const g = (rank: bigint, collected: bigint, key: string, label: string | null = null) => ({
    rank,
    collected,
    row: { key, label },
  });
  it('biggest invoiced first, then biggest collected, then by name', () => {
    const rows = [
      g(5n, 0n, 'b', 'Bravo'),
      g(9n, 0n, 'x', 'X'),
      g(5n, 7n, 'c', 'Charlie'),
      g(5n, 0n, 'a', 'Alpha'),
      g(5n, 0n, 'z'),
    ];
    expect(rows.sort(compareRows).map((r) => r.row.key)).toEqual(['x', 'c', 'a', 'b', 'z']);
  });
});
