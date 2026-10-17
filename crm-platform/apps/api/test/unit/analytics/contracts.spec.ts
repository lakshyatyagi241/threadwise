import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENT,
  LATENCY_EDGES_MS,
  METRIC,
  METRICS,
  assertNoPii,
  histBucket,
  percentileFromBuckets,
} from '@crm/contracts';

describe('analytics event registry', () => {
  it('has unique positive ids that fit a smallint', () => {
    const ids = Object.values(ANALYTICS_EVENT);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThan(32768);
    }
  });

  it('pins ids that are stored forever (never renumber)', () => {
    expect(ANALYTICS_EVENT.MSG_QUEUED).toBe(1);
    expect(ANALYTICS_EVENT.MSG_RECEIVED).toBe(6);
    expect(ANALYTICS_EVENT.CONV_FIRST_REPLY).toBe(42);
    expect(ANALYTICS_EVENT.BILL_CHARGE).toBe(110);
  });
});

describe('metric registry', () => {
  it('has unique ids and keys, at most three dimensions each', () => {
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length);
    expect(new Set(METRICS.map((m) => m.key)).size).toBe(METRICS.length);
    for (const m of METRICS) expect(m.dims.length).toBeLessThanOrEqual(3);
    expect(METRICS.map((m) => m.id)).toContain(METRIC.MSG_COUNT);
  });
});

describe('latency histogram', () => {
  it('puts a value in the bucket of the first edge above it', () => {
    expect(histBucket(0)).toBe(0);
    expect(histBucket(999)).toBe(0);
    expect(histBucket(1000)).toBe(1);
    expect(histBucket(LATENCY_EDGES_MS[LATENCY_EDGES_MS.length - 1]!)).toBe(
      LATENCY_EDGES_MS.length,
    );
  });

  it('returns the upper edge of the bucket that holds the percentile', () => {
    const counts = new Array<number>(LATENCY_EDGES_MS.length + 1).fill(0);
    counts[1] = 50;
    counts[3] = 50;
    expect(percentileFromBuckets(counts, 0.5)).toBe(LATENCY_EDGES_MS[1]);
    expect(percentileFromBuckets(counts, 0.51)).toBe(LATENCY_EDGES_MS[3]);
    expect(percentileFromBuckets(new Array(LATENCY_EDGES_MS.length + 1).fill(0), 0.5)).toBeNull();
  });
});

describe('PII guard for props', () => {
  it('accepts plain codes and counters', () => {
    expect(() => assertNoPii({ reason: 'timeout', attempt: 3, retried: true })).not.toThrow();
    expect(() => assertNoPii(undefined)).not.toThrow();
  });

  it('rejects personal-looking keys and values', () => {
    expect(() => assertNoPii({ phone: '1' })).toThrow(/personal data/);
    expect(() => assertNoPii({ note: 'a@b.co' })).toThrow(/personal data/);
    expect(() => assertNoPii({ note: '+919876543210' })).toThrow(/personal data/);
    expect(() => assertNoPii({ note: 'x'.repeat(65) })).toThrow(/personal data/);
  });
});
