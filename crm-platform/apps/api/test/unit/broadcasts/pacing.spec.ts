import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACING,
  batchCooldownMs,
  batchingApplies,
  capRemaining,
  jitter,
  nextGapMs,
  nextUtcMidnight,
  utcDayKey,
} from '../../../src/modules/broadcasts/pacing';

const fixed = (v: number) => () => v;

describe('jitter (WD-BCAST-022)', () => {
  it('varies the base by up to 20%: 3 s is 2.4 to 3.6 s', () => {
    expect(jitter(3, 0.2, fixed(0))).toBeCloseTo(2.4);
    expect(jitter(3, 0.2, fixed(0.5))).toBeCloseTo(3);
    expect(jitter(3, 0.2, fixed(1))).toBeCloseTo(3.6);
  });
  it('is 0 for a base of 0', () => {
    expect(jitter(0, 0.2, fixed(0.9))).toBe(0);
  });
});

describe('nextGapMs', () => {
  it('uses the setting with jitter when the sender is not warming', () => {
    expect(nextGapMs(DEFAULT_PACING, null, fixed(0))).toBe(2400);
    expect(nextGapMs(DEFAULT_PACING, null, fixed(1))).toBe(3600);
  });
  it('uses the warmer range when the sender is warming, never under 1 s', () => {
    expect(nextGapMs(DEFAULT_PACING, { min: 10, max: 20 }, fixed(0))).toBe(10_000);
    expect(nextGapMs(DEFAULT_PACING, { min: 10, max: 20 }, fixed(1))).toBe(20_000);
    expect(nextGapMs(DEFAULT_PACING, { min: 0, max: 0 }, fixed(0.5))).toBe(1000);
  });
});

describe('batches (WD-BCAST-022 acceptance)', () => {
  const on = { ...DEFAULT_PACING, enableBatches: true };
  it('apply only when on and the audience is bigger than a batch', () => {
    expect(batchingApplies(on, 120)).toBe(true);
    expect(batchingApplies(on, 50)).toBe(false);
    expect(batchingApplies(DEFAULT_PACING, 5000)).toBe(false);
  });
  it('wait 5 minutes plus or minus 20% between batches: 4 to 6 minutes', () => {
    expect(batchCooldownMs(on, fixed(0))).toBe(240_000);
    expect(batchCooldownMs(on, fixed(1))).toBe(360_000);
  });
});

describe('daily cap', () => {
  it('counts down and never goes below zero', () => {
    expect(capRemaining(4000, 3990)).toBe(10);
    expect(capRemaining(4000, 4000)).toBe(0);
    expect(capRemaining(4000, 4100)).toBe(0);
  });
  it('is keyed by the UTC day and resets at the next UTC midnight', () => {
    expect(utcDayKey(new Date('2026-10-02T23:59:59Z'))).toBe('20261002');
    expect(utcDayKey(new Date('2026-10-03T00:00:00Z'))).toBe('20261003');
    expect(nextUtcMidnight(new Date('2026-10-02T23:59:59Z')).toISOString()).toBe(
      '2026-10-03T00:00:00.000Z',
    );
    expect(nextUtcMidnight(new Date('2026-12-31T10:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});
