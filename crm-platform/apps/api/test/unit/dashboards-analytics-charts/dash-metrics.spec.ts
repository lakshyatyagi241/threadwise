import { describe, expect, it } from 'vitest';
import { csvCell } from '../../../src/modules/dashboards-analytics-charts/dash.service';
import {
  deltaPp,
  funnelOf,
  percentChange,
  totalsOf,
} from '../../../src/modules/dashboards-analytics-charts/dash-metrics';

const zero = { sent: 0, delivered: 0, failed: 0, read: 0, replies: 0, repliers: 0 };

describe('metric rules (TW-DASH-002)', () => {
  it('percent change: previous 0 and now positive is +100; both 0 is 0; otherwise one decimal', () => {
    expect(percentChange(4, 0)).toBe(100);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(100, 50)).toBe(100);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(1, 3)).toBe(-66.7);
  });

  it('rate delta is in percentage points', () => {
    expect(deltaPp(25, 20)).toBe(5);
  });

  it('rates are one decimal and 0 for no sends; queued never goes below 0', () => {
    const t = totalsOf({
      sent: 200,
      delivered: 180,
      failed: 5,
      read: 50,
      replies: 30,
      repliers: 20,
    });
    expect(t).toMatchObject({ readRate: 25, deliverability: 90, replyRate: 15, queued: 15 });
    expect(totalsOf(zero)).toMatchObject({
      readRate: 0,
      deliverability: 0,
      replyRate: 0,
      queued: 0,
    });
    expect(totalsOf({ ...zero, sent: 1, delivered: 2 }).queued).toBe(0);
  });

  it('funnel: 100 sent, 90 delivered, 30 replies, 20 repliers', () => {
    const f = funnelOf(
      totalsOf({ sent: 100, delivered: 90, failed: 0, read: 0, replies: 30, repliers: 20 }),
    );
    expect(f.stages.map((s) => [s.count, s.pct, s.drop])).toEqual([
      [100, 100, 0],
      [90, 90, 10],
      [30, 30, 60],
      [20, 20, 10],
    ]);
    expect(f.endToEnd).toBe(20);
  });

  it('funnel with no sends is all zero', () => {
    const f = funnelOf(totalsOf(zero));
    expect(f.stages.every((s) => s.count === 0 && s.pct === 0 && s.drop === 0)).toBe(true);
    expect(f.endToEnd).toBe(0);
  });
});

describe('CSV cells (TW-DASH-032)', () => {
  it('neutralises formulas, keeps plain numbers, quotes commas and quotes', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
});
