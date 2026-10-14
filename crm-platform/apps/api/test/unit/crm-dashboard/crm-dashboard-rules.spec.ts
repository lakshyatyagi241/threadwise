import { describe, expect, it } from 'vitest';
import {
  bucketFor,
  bucketStart,
  bucketStarts,
  funnelConversions,
  percent,
  resolvePeriod,
  winRate,
} from '../../../src/modules/crm/crm-dashboard/crm-dashboard-rules';
import { todayIn } from '../../../src/modules/crm/deals/deal-calendar';

describe('resolvePeriod', () => {
  it('month is the calendar month to date; the previous window has as many days and ends the day before', () => {
    const p = resolvePeriod('month', 'UTC', '2026-10-14');
    expect([p.fromDate, p.toDate, p.days]).toEqual(['2026-10-01', '2026-10-14', 14]);
    expect([p.prevFromDate, p.prevToDate]).toEqual(['2026-09-17', '2026-09-30']);
    expect(p.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(p.toExclusive.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(p.prevToExclusive.toISOString()).toBe(p.from.toISOString());
  });

  it('7d / 30d / 90d end today and include it', () => {
    expect(resolvePeriod('7d', 'UTC', '2026-10-14')).toMatchObject({
      fromDate: '2026-10-08',
      days: 7,
    });
    expect(resolvePeriod('30d', 'UTC', '2026-10-14')).toMatchObject({
      fromDate: '2026-09-15',
      days: 30,
    });
    expect(resolvePeriod('90d', 'UTC', '2026-10-14')).toMatchObject({
      fromDate: '2026-07-17',
      days: 90,
    });
  });

  it('cuts the bounds at local midnights across a spring-forward change (America/New_York, March 2026)', () => {
    const p = resolvePeriod('custom', 'America/New_York', '2026-04-10', {
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(p.days).toBe(31);
    // EST (UTC-5) at the start, EDT (UTC-4) at the end: 31 days but 743 hours, not 744.
    expect(p.from.toISOString()).toBe('2026-03-01T05:00:00.000Z');
    expect(p.toExclusive.toISOString()).toBe('2026-04-01T04:00:00.000Z');
    expect((p.toExclusive.getTime() - p.from.getTime()) / 3_600_000).toBe(743);
    expect(p.prevFromDate).toBe('2026-01-29');
    expect(p.prevFrom.toISOString()).toBe('2026-01-29T05:00:00.000Z');
  });

  it('cuts the bounds across a fall-back change (Europe/London, October 2026)', () => {
    const p = resolvePeriod('custom', 'Europe/London', '2026-11-10', {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    // BST (UTC+1) at the start, GMT at the end: 745 hours.
    expect(p.from.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(p.toExclusive.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect((p.toExclusive.getTime() - p.from.getTime()) / 3_600_000).toBe(745);
  });

  it('half-hour and 45-minute zones keep their own midnight', () => {
    expect(resolvePeriod('7d', 'Asia/Kolkata', '2026-10-14').from.toISOString()).toBe(
      '2026-10-07T18:30:00.000Z',
    );
    expect(resolvePeriod('7d', 'Asia/Kathmandu', '2026-10-14').from.toISOString()).toBe(
      '2026-10-07T18:15:00.000Z',
    );
  });

  it('today is the viewer day: 20:00 UTC is already tomorrow in Kolkata and still the same day in Los Angeles', () => {
    const now = new Date('2026-10-14T20:00:00Z');
    expect(todayIn('Asia/Kolkata', now)).toBe('2026-10-15');
    expect(todayIn('America/Los_Angeles', now)).toBe('2026-10-14');
    expect(todayIn('Pacific/Auckland', now)).toBe('2026-10-15');
  });

  it('a custom period: a future end is cut to today, a missing start is 29 days back, a start after the end is cut to it', () => {
    expect(resolvePeriod('custom', 'UTC', '2026-10-14', { to: '2027-01-01' })).toMatchObject({
      toDate: '2026-10-14',
      fromDate: '2026-09-15',
      days: 30,
    });
    expect(
      resolvePeriod('custom', 'UTC', '2026-10-14', { from: '2026-10-20', to: '2026-10-12' }),
    ).toMatchObject({ fromDate: '2026-10-12', toDate: '2026-10-12', days: 1 });
  });

  it('refuses a custom period over 366 days with 422, accepts 366', () => {
    expect(() =>
      resolvePeriod('custom', 'UTC', '2026-10-14', { from: '2025-01-01', to: '2026-10-14' }),
    ).toThrowError(/at most 366/);
    expect(
      resolvePeriod('custom', 'UTC', '2026-12-31', { from: '2026-01-01', to: '2026-12-31' }).days,
    ).toBe(365);
    expect(
      resolvePeriod('custom', 'UTC', '2028-12-31', { from: '2028-01-01', to: '2028-12-31' }).days,
    ).toBe(366);
  });
});

describe('trend buckets', () => {
  it('daily to 31 days, weekly to 140, monthly beyond', () => {
    expect([1, 31, 32, 140, 141, 366].map(bucketFor)).toEqual([
      'day',
      'day',
      'week',
      'week',
      'month',
      'month',
    ]);
  });

  it('a week starts on Monday', () => {
    expect(bucketStart('2026-10-14', 'week')).toBe('2026-10-12'); // Wednesday
    expect(bucketStart('2026-10-12', 'week')).toBe('2026-10-12'); // Monday
    expect(bucketStart('2026-10-18', 'week')).toBe('2026-10-12'); // Sunday
    expect(bucketStart('2026-01-01', 'week')).toBe('2025-12-29');
  });

  it('lists every bucket, empty ones included, across a year end', () => {
    expect(bucketStarts('2026-12-30', '2027-01-02', 'day')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(bucketStarts('2026-12-30', '2027-01-12', 'week')).toEqual([
      '2026-12-28',
      '2027-01-04',
      '2027-01-11',
    ]);
    expect(bucketStarts('2026-11-15', '2027-02-03', 'month')).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ]);
  });
});

describe('percentages and the funnel', () => {
  it('rounds half up and never divides by zero', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(1, 2)).toBe(50);
    expect(percent(5, 0)).toBe(0);
  });

  it('win rate is won / (won + lost)', () => {
    expect(winRate(3, 1)).toBe(75);
    expect(winRate(0, 0)).toBe(0);
    expect(winRate(0, 4)).toBe(0);
    expect(winRate(4, 0)).toBe(100);
  });

  it('conversion is each stage over the one before; the first has none; an empty stage gives null, never a division by zero', () => {
    expect(funnelConversions([100, 60, 30, 30])).toEqual([null, 60, 50, 100]);
    expect(funnelConversions([0, 0, 0])).toEqual([null, null, null]);
    expect(funnelConversions([10, 0, 0])).toEqual([null, 0, null]);
    expect(funnelConversions([])).toEqual([]);
  });
});
