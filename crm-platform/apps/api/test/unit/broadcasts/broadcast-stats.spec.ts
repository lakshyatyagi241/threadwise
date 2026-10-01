import { describe, expect, it } from 'vitest';
import {
  cascade,
  deliveryCurve,
  donut,
  failureHistogram,
  headerPct,
  liveStats,
  pct,
} from '../../../src/modules/broadcasts/broadcast-stats';

const c = (o: Partial<Record<string, number>> = {}) => ({
  pending: 0,
  processing: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  ...o,
});

describe('pct', () => {
  it('rounds to one decimal and is 0 when the base is 0', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(2, 3)).toBe(66.7);
    expect(pct(5, 0)).toBe(0);
  });
});

describe('cascade and header percentages (TW-BCAST-030)', () => {
  it('a higher tier includes the lower ones', () => {
    expect(cascade(c({ pending: 1, sent: 2, delivered: 3, read: 4, failed: 5 }))).toMatchObject({
      total: 15,
      sent: 9,
      delivered: 7,
      read: 4,
      failed: 5,
      queued: 1,
    });
  });

  it('sent, delivered and failed are over the audience, read over delivered', () => {
    const k = cascade(c({ sent: 2, delivered: 1, read: 1, failed: 1, pending: 1 })); // total 6
    expect(headerPct(k)).toEqual({ sent: 66.7, delivered: 33.3, read: 50, failed: 16.7 });
  });

  it('is all zero for an empty broadcast', () => {
    expect(headerPct(cascade(c()))).toEqual({ sent: 0, delivered: 0, read: 0, failed: 0 });
  });
});

describe('donut (TW-BCAST-031)', () => {
  it('splits sent, delivered, read, queued, failed and centres on the share that is neither failed nor waiting', () => {
    expect(donut(c({ sent: 2, delivered: 3, read: 1, pending: 2, failed: 2 }))).toEqual({
      labels: ['Sent', 'Delivered', 'Read', 'Queued', 'Failed'],
      series: [2, 3, 1, 2, 2],
      successPct: 60,
    });
  });
  it('is 0 for an empty broadcast', () => {
    expect(donut(c()).successPct).toBe(0);
  });
});

describe('liveStats (TW-BCAST-035)', () => {
  const now = new Date('2026-10-02T10:00:00Z');
  it('reports the cascade, percentages over the audience and whether it is still moving', () => {
    const live = liveStats('processing', c({ pending: 2, sent: 1, delivered: 1, failed: 0 }), now);
    expect(live).toMatchObject({
      status: 'processing',
      total: 4,
      sent: 2,
      delivered: 1,
      read: 0,
      failed: 0,
      queued: 2,
      inFlight: true,
    });
    expect(live.pct.sent).toBe(50);
    expect(live.fetchedAt).toBe('2026-10-02T10:00:00.000Z');
  });
  it('stops being in flight once the broadcast is over', () => {
    for (const s of ['completed', 'completed_with_errors', 'failed', 'paused'])
      expect(liveStats(s, c({ sent: 1 }), now).inFlight).toBe(false);
    for (const s of ['processing', 'scheduled', 'queued'])
      expect(liveStats(s, c({ sent: 1 }), now).inFlight).toBe(true);
  });
});

describe('failureHistogram (TW-BCAST-033)', () => {
  it('groups identical reasons, calls a missing one Unknown, sorts by count', () => {
    expect(
      failureHistogram([
        { reason: 'no phone', count: 2 },
        { reason: null, count: 1 },
        { reason: ' ', count: 3 },
        { reason: 'no phone', count: 1 },
      ]),
    ).toEqual([
      { reason: 'Unknown', count: 4 },
      { reason: 'no phone', count: 3 },
    ]);
  });
  it('keeps the top 8 and sums the rest into Other', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ reason: `r${i}`, count: 10 - i }));
    const out = failureHistogram(rows);
    expect(out).toHaveLength(9);
    expect(out[8]).toEqual({ reason: 'Other', count: 2 + 1 });
  });
  it('is empty when nothing failed', () => {
    expect(failureHistogram([])).toEqual([]);
  });
});

describe('deliveryCurve (TW-BCAST-031)', () => {
  it('runs from the creation hour to the latest event hour, labelled H:00', () => {
    const curve = deliveryCurve('2026-10-02 09', {
      sent: [
        { hour: '2026-10-02 09', n: 5 },
        { hour: '2026-10-02 10', n: 2 },
      ],
      delivered: [{ hour: '2026-10-02 10', n: 4 }],
      read: [{ hour: '2026-10-02 11', n: 1 }],
    });
    expect(curve.labels).toEqual(['9:00', '10:00', '11:00']);
    expect(curve.sent).toEqual([5, 2, 0]);
    expect(curve.delivered).toEqual([0, 4, 0]);
    expect(curve.read).toEqual([0, 0, 1]);
  });
  it('is one bucket when there are no events', () => {
    expect(deliveryCurve('2026-10-02 09', { sent: [], delivered: [], read: [] }).labels).toEqual([
      '9:00',
      '10:00',
    ]);
  });
  it('is at most 24 buckets and drops events beyond them', () => {
    const curve = deliveryCurve('2026-10-01 00', {
      sent: [{ hour: '2026-10-03 05', n: 9 }],
      delivered: [],
      read: [],
    });
    expect(curve.labels).toHaveLength(24);
    expect(curve.sent.reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('never starts before the creation hour', () => {
    const curve = deliveryCurve('2026-10-02 09', {
      sent: [{ hour: '2026-10-02 07', n: 3 }],
      delivered: [],
      read: [],
    });
    expect(curve.sent.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
