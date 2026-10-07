import { describe, expect, it } from 'vitest';
import {
  ALL_TIME_START,
  MAX_DAILY_POINTS,
  bucketStarts,
  defaultBucket,
  deltaPercent,
  fillSeries,
  rangeWindow,
} from '../../../src/modules/coupons-credits-referral-currency/referral-windows';

// A Wednesday, mid-afternoon: the week/month edges below are computed from it.
const NOW = new Date('2026-10-07T15:30:00.000Z');

describe('WD-CPN-035 range windows', () => {
  it('WD-CPN-035 7d, 30d and 90d start that many days back and the previous window has the same length right before', () => {
    for (const [range, days] of [
      ['7d', 7],
      ['30d', 30],
      ['90d', 90],
    ] as const) {
      const w = rangeWindow(range, NOW);
      expect(w.days).toBe(days);
      expect(NOW.getTime() - w.start.getTime()).toBe(days * 86_400_000);
      expect(w.start.getTime() - w.previousStart.getTime()).toBe(days * 86_400_000);
    }
  });

  it('WD-CPN-035 "all" reads from 2020-01-01 but is bucketed as five years', () => {
    const w = rangeWindow('all', NOW);
    expect(w.start).toEqual(ALL_TIME_START);
    expect(w.days).toBe(1825);
  });

  it('WD-CPN-035 the default bucket is daily up to 14 days, weekly up to 90, monthly beyond', () => {
    expect(defaultBucket('7d')).toBe('daily');
    expect(defaultBucket('30d')).toBe('weekly');
    expect(defaultBucket('90d')).toBe('weekly');
    expect(defaultBucket('all')).toBe('monthly');
  });
});

describe('WD-CPN-035 delta against the previous window', () => {
  it('WD-CPN-035 is the rounded percent change, +100 from nothing, 0 when both are empty', () => {
    expect(deltaPercent(15, 10)).toBe(50);
    expect(deltaPercent(5, 10)).toBe(-50);
    expect(deltaPercent(1, 3)).toBe(-67);
    expect(deltaPercent(3, 3)).toBe(0);
    expect(deltaPercent(4, 0)).toBe(100);
    expect(deltaPercent(0, 0)).toBe(0);
    expect(deltaPercent(0, 7)).toBe(-100);
  });
});

describe('WD-CPN-035 chart buckets', () => {
  it('WD-CPN-035 daily: one point per day, ending today (7d -> 7, 90d -> 90 points, so "Daily" on 90 days is really daily)', () => {
    const seven = bucketStarts('daily', '7d', NOW);
    expect(seven).toHaveLength(7);
    expect(seven[0]).toBe('2026-10-01');
    expect(seven.at(-1)).toBe('2026-10-07');
    expect(bucketStarts('daily', '90d', NOW)).toHaveLength(90);
  });

  it('WD-CPN-035 daily over all time draws only the most recent year', () => {
    expect(bucketStarts('daily', 'all', NOW)).toHaveLength(MAX_DAILY_POINTS);
  });

  it('WD-CPN-035 weekly: ceil(days/7) weeks starting Monday, the last one holding today', () => {
    const w = bucketStarts('weekly', '30d', NOW);
    expect(w).toHaveLength(5);
    expect(w.at(-1)).toBe('2026-10-05');
    expect(new Date(`${w[0]}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(bucketStarts('weekly', '90d', NOW)).toHaveLength(13);
  });

  it('WD-CPN-035 monthly: ceil(days/30) calendar months ending with this one', () => {
    const m = bucketStarts('monthly', '90d', NOW);
    expect(m).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(bucketStarts('monthly', 'all', NOW)).toHaveLength(61);
  });

  it('WD-CPN-035 a week that crosses a year boundary still starts on a Monday', () => {
    const w = bucketStarts('weekly', '7d', new Date('2027-01-01T10:00:00Z'));
    expect(w).toEqual(['2026-12-28']);
  });

  it('WD-CPN-035 fills days without sign-ups with zero points and keeps the order', () => {
    const starts = bucketStarts('daily', '7d', NOW);
    const series = fillSeries(starts, [
      { start: '2026-10-03', signups: 2, creditsMinor: 300 },
      { start: '2026-09-01', signups: 9, creditsMinor: 9 },
    ]);
    expect(series.map((p) => p.start)).toEqual(starts);
    expect(series.find((p) => p.start === '2026-10-03')).toEqual({
      start: '2026-10-03',
      signups: 2,
      creditsMinor: 300,
    });
    expect(series.reduce((s, p) => s + p.signups, 0)).toBe(2);
  });
});
