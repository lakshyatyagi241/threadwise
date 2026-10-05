import { describe, expect, it } from 'vitest';
import { monthlyOf } from '../../../src/modules/dashboards-analytics-charts/platform-metrics.service';
import {
  Fx,
  changePct,
  countryOfPhone,
  countryRows,
  dateSpine,
  healthOf,
  isoCountry,
  overviewWindow,
  regionCounts,
  revenueBuckets,
  revenueTargets,
  spikeRatio,
} from '../../../src/modules/dashboards-analytics-charts/platform-rules';

const now = new Date('2026-10-14T10:30:00Z');

describe('admin overview rules (WD-DASH-034..040)', () => {
  it('delta: previous 0 and now positive is +100.00, both 0 is 0.00', () => {
    expect(changePct(1000, 800)).toBe('25.00');
    expect(changePct(5, 0)).toBe('100.00');
    expect(changePct(0, 0)).toBe('0.00');
  });

  it('windows are exact spans ending at the end of today, previous window just before', () => {
    const w = overviewWindow('7d', now);
    expect(w.to.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(w.from.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(w.prevFrom.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(overviewWindow('24h', now).days).toBe(1);
    expect(overviewWindow('1y', now).days).toBe(365);
  });

  it('7d has one bucket per day; 30d/90d/1y buckets reach the end of the window', () => {
    expect(revenueBuckets(overviewWindow('7d', now))).toHaveLength(7);
    for (const w of ['24h', '30d', '90d', '1y'] as const) {
      const win = overviewWindow(w, now);
      const b = revenueBuckets(win);
      expect(b.length).toBeLessThanOrEqual(12);
      expect(b[b.length - 1]!.end.getTime()).toBe(win.to.getTime());
      expect(b[0]!.start.getTime()).toBe(win.from.getTime());
    }
    expect(revenueBuckets(overviewWindow('7d', now))[0]!.label).toBe('Oct 8');
    expect(revenueBuckets(overviewWindow('1y', now))[0]!.label).toMatch(/^\w{3} \d{4}$/);
  });

  it('targets: bucket one is revenue x 0.99, later ones previous x 1.1, never below 100', () => {
    expect(revenueTargets([100, 200])).toEqual([100, 110]);
    expect(revenueTargets([0, 0, 0])).toEqual([100, 100, 100]);
    expect(revenueTargets([1000, 0])).toEqual([990, 1100]);
  });

  it('workspace health: 500 good, 50 active, above 0 low, else idle', () => {
    expect(['500', '120', '3', '0'].map((n) => healthOf(Number(n)))).toEqual([
      'good',
      'active',
      'low',
      'idle',
    ]);
  });

  it('spike: last hour at least 3x a positive hourly average, ratio to one decimal', () => {
    expect(spikeRatio(40, 840)).toBe(8); // average 5 per hour
    expect(spikeRatio(14, 840)).toBeNull();
    expect(spikeRatio(10, 0)).toBeNull(); // brand-new workspace never triggers
  });

  it('region radar rolls ISO codes into six regions', () => {
    const r = regionCounts(
      new Map([
        ['IN', 5],
        ['US', 3],
        ['DE', 1],
      ]),
    );
    expect(r.map((x) => x.region)).toEqual([
      'Europe',
      'Americas',
      'Africa',
      'Middle East',
      'Pacific',
      'Asia',
    ]);
    expect(r.find((x) => x.region === 'Asia')!.count).toBe(5);
  });

  it('currency conversion takes an unknown currency at par and zero-fills the spine', () => {
    const fx = new Fx(
      'USD',
      new Map([
        ['USD', 1],
        ['EUR', 0.5],
      ]),
    );
    expect(fx.toBase(10, 'EUR')).toBe(20);
    expect(fx.toBase('7', 'XXX')).toBe(7);
    expect(dateSpine(new Date('2026-10-01T00:00:00Z'), 3)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });

  it('MRR is monthly-normalised and offer-aware', () => {
    const p = {
      amount: '120',
      offer_amount: null,
      billing_unit: 'years',
      billing_duration: 1,
      is_free: false,
    };
    expect(monthlyOf(p)).toBe(10);
    expect(monthlyOf({ ...p, amount: '29', offer_amount: '19', billing_unit: 'months' })).toBe(19);
    expect(monthlyOf({ ...p, is_free: true })).toBe(0);
    expect(monthlyOf({ ...p, amount: null })).toBe(0);
  });
});

describe('country panels (WD-DASH-037)', () => {
  it('takes an ISO country, else maps the dial prefix, else drops the profile', () => {
    expect(isoCountry('in', null)).toBe('IN');
    expect(isoCountry(null, 'DE')).toBe('DE');
    expect(isoCountry(null, '+91')).toBe('IN');
    expect(isoCountry('', '44')).toBe('GB');
    expect(isoCountry(null, '999')).toBeNull();
    expect(isoCountry(null, null)).toBeNull();
  });

  it('lists the top four; the share is of the four, one decimal; an unknown code keeps its code as the name', () => {
    const rows = countryRows(
      new Map([
        ['IN', 5],
        ['US', 3],
        ['DE', 1],
        ['GB', 1],
        ['FR', 1],
        ['ZA', 1],
      ]),
    );
    expect(rows.map((r) => r.pct)).toEqual(['50.0', '30.0', '10.0', '10.0']);
    // equal counts rank by code, so the cut falls between FR and GB
    expect(rows.map((r) => r.code)).toEqual(['IN', 'US', 'DE', 'FR']);
    expect(countryRows(new Map([['FR', 2]]))[0]).toEqual({
      code: 'FR',
      name: 'FR',
      count: 2,
      pct: '100.0',
    });
    expect(countryRows(new Map())).toEqual([]);
  });
});

describe('countryOfPhone (WD-DASH-029)', () => {
  it('takes the longest known dial prefix and refuses numbers that are too short or unknown', () => {
    expect(countryOfPhone('919876543210')).toBe('IN');
    expect(countryOfPhone('14155550100')).toBe('US');
    expect(countryOfPhone('447700900123')).toBe('GB');
    expect(countryOfPhone('2348012345678')).toBe('NG'); // three-digit prefix wins over nothing
    expect(countryOfPhone('999999999')).toBeNull();
    expect(countryOfPhone('9112')).toBeNull();
  });
});
