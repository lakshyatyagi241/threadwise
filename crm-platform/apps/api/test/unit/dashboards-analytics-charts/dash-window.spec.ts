import { describe, expect, it } from 'vitest';
import { analyticsQuerySchema, dashSummaryQuerySchema } from '@crm/contracts';
import {
  resolveAnalyticsWindow,
  resolveDashWindow,
  todayIn,
  zonedHourStart,
  zonedMidnight,
} from '../../../src/modules/dashboards-analytics-charts/dash-window';

const NOW = new Date('2026-10-14T10:30:00Z');

describe('dashboard windows (WD-DASH-003)', () => {
  it('an unknown range reads as 7d', () => {
    expect(dashSummaryQuerySchema.parse({ range: 'bogus' }).range).toBe('7d');
    expect(dashSummaryQuerySchema.parse({}).range).toBe('7d');
    expect(dashSummaryQuerySchema.parse({ range: 'qtd' }).range).toBe('qtd');
  });

  it('24h is the rolling day, previous window the 24 hours before it', () => {
    const w = resolveDashWindow('24h', 'UTC', NOW);
    expect(w.to).toEqual(NOW);
    expect(w.to.getTime() - w.from.getTime()).toBe(86_400_000);
    expect(w.prevTo).toEqual(w.from);
    expect(w.from.getTime() - w.prevFrom.getTime()).toBe(86_400_000);
    expect(w.bucket).toBe('hour');
  });

  it('7d runs from the start of the day 7 days ago to the end of today (8 days), previous window the same 8 days', () => {
    const w = resolveDashWindow('7d', 'UTC', NOW);
    expect(w.from.toISOString()).toBe('2026-10-07T00:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(w.days).toBe(8);
    expect(w.prevFrom.toISOString()).toBe('2026-09-29T00:00:00.000Z');
    expect(w.prevTo).toEqual(w.from);
  });

  it('30d is 31 days; qtd starts on the first day of the calendar quarter', () => {
    expect(resolveDashWindow('30d', 'UTC', NOW).days).toBe(31);
    const q = resolveDashWindow('qtd', 'UTC', NOW);
    expect(q.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(q.days).toBe(14);
    expect(q.prevTo).toEqual(q.from);
  });

  it('cuts days in the workspace zone, so a message at 02:00 UTC belongs to the next day in Jakarta', () => {
    expect(todayIn('Asia/Jakarta', new Date('2026-10-14T20:00:00Z'))).toBe('2026-10-15');
    expect(zonedMidnight('2026-10-15', 'Asia/Jakarta').toISOString()).toBe(
      '2026-10-14T17:00:00.000Z',
    );
    expect(zonedMidnight('2026-10-15', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-14T18:30:00.000Z',
    );
  });

  it('a window over a daylight-saving change keeps equal day counts', () => {
    const w = resolveDashWindow('7d', 'Europe/Berlin', new Date('2026-10-28T12:00:00Z'));
    expect(w.days).toBe(8);
    expect(w.from.toISOString()).toBe('2026-10-20T22:00:00.000Z');
    // clocks went back on 25 Oct: the previous window starts at local midnight 8 calendar days earlier
    expect(w.prevFrom.toISOString()).toBe('2026-10-12T22:00:00.000Z');
  });

  it('hour buckets start on the zone hour, half-hour zones included', () => {
    expect(zonedHourStart(new Date('2026-10-14T10:45:00Z'), 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-14T10:30:00.000Z',
    );
    expect(zonedHourStart(new Date('2026-10-14T10:45:00Z'), 'UTC').toISOString()).toBe(
      '2026-10-14T10:00:00.000Z',
    );
  });
});

describe('analytics windows (WD-DASH-022)', () => {
  const q = (o: Record<string, string>) => analyticsQuerySchema.parse(o);

  it('defaults to the last 30 days ending today', () => {
    const w = resolveAnalyticsWindow(q({}), 'UTC', NOW)!;
    expect(q({}).range).toBe('30d');
    expect(w.fromDate).toBe('2026-09-14');
    expect(w.toDate).toBe('2026-10-14');
    expect(w.days).toBe(31);
  });

  it('swaps an inverted custom range', () => {
    const w = resolveAnalyticsWindow(
      q({ range: 'custom', from: '2026-05-10', to: '2026-05-01' }),
      'UTC',
      NOW,
    )!;
    expect([w.fromDate, w.toDate]).toEqual(['2026-05-01', '2026-05-10']);
    expect(w.days).toBe(10);
    expect(w.prevTo).toEqual(w.from);
  });

  it('a custom range with no dates is the last 30 days; garbage dates are dropped', () => {
    const w = resolveAnalyticsWindow(q({ range: 'custom', from: 'nope' }), 'UTC', NOW)!;
    expect([w.fromDate, w.toDate]).toEqual(['2026-09-14', '2026-10-14']);
  });

  it('refuses spans over 366 days', () => {
    expect(
      resolveAnalyticsWindow(
        q({ range: 'custom', from: '2024-01-01', to: '2026-01-01' }),
        'UTC',
        NOW,
      ),
    ).toBeNull();
  });
});
