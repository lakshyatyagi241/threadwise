import { describe, expect, it } from 'vitest';
import {
  MIN_SPEED_FACTOR,
  RECOVERY_MS,
  afterThrottle,
  hourBucket,
  msUntilNextHour,
  parseThroughput,
  parseTier,
  recoveredFactor,
  resolveRate,
  throughputChanged,
  tierState,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/throughput/throughput-rules';

describe('parseThroughput', () => {
  it('reads the documented levels', () => {
    expect(parseThroughput({ level: 'STANDARD' })).toEqual({ level: 'STANDARD', mps: 80 });
    expect(parseThroughput({ level: 'HIGH' })).toEqual({ level: 'HIGH', mps: 1000 });
    expect(parseThroughput('high')).toEqual({ level: 'HIGH', mps: 1000 });
  });

  it('keeps a level it does not know, without inventing a rate', () => {
    expect(parseThroughput({ level: 'NOT_APPLICABLE' })).toEqual({
      level: 'NOT_APPLICABLE',
      mps: null,
    });
  });

  it('accepts a number, clamped to 1..1000', () => {
    expect(parseThroughput(250).mps).toBe(250);
    expect(parseThroughput(5000).mps).toBe(1000);
    expect(parseThroughput({ mps: 40 }).mps).toBe(40);
  });

  it.each([null, undefined, {}, [], 0, -3, '', 'x'])('treats %j as unknown', (raw) => {
    expect(parseThroughput(raw).mps).toBeNull();
  });
});

describe('parseTier', () => {
  it.each([
    ['TIER_50', 50],
    ['TIER_250', 250],
    ['TIER_1K', 1_000],
    ['TIER_10K', 10_000],
    ['TIER_100K', 100_000],
  ])('%s is %i recipients a day', (name, cap) => {
    expect(parseTier(name)).toEqual({ name, cap, unlimited: false });
  });

  it('knows unlimited', () => {
    expect(parseTier('TIER_UNLIMITED')).toEqual({
      name: 'TIER_UNLIMITED',
      cap: null,
      unlimited: true,
    });
  });

  it('does not guess a tier it cannot read', () => {
    expect(parseTier(null)).toEqual({ name: null, cap: null, unlimited: false });
    expect(parseTier('GOLD')).toEqual({ name: 'GOLD', cap: null, unlimited: false });
  });
});

describe('resolveRate', () => {
  const base = {
    overrideMps: null,
    coexistence: false,
    metaMps: null,
    defaultMps: 80,
    safetyMarginPct: 10,
  };

  it('uses the platform default when Meta has not said', () => {
    expect(resolveRate(base)).toEqual({ capMps: 80, mps: 72, source: 'default' });
  });

  it("follows Meta's value", () => {
    expect(resolveRate({ ...base, metaMps: 1000 })).toEqual({
      capMps: 1000,
      mps: 900,
      source: 'meta',
    });
  });

  it('holds a coexistence number at 20, whatever Meta says', () => {
    expect(resolveRate({ ...base, coexistence: true, metaMps: 1000 })).toEqual({
      capMps: 20,
      mps: 18,
      source: 'coexistence',
    });
  });

  it('uses an operator override exactly, without the margin', () => {
    expect(resolveRate({ ...base, overrideMps: 33, coexistence: true, metaMps: 1000 })).toEqual({
      capMps: 33,
      mps: 33,
      source: 'override',
    });
  });

  it('never goes below one message per second', () => {
    expect(resolveRate({ ...base, defaultMps: 1, safetyMarginPct: 50 }).mps).toBe(1);
  });

  it('caps an override at Meta’s highest level', () => {
    expect(resolveRate({ ...base, overrideMps: 9999 }).mps).toBe(1000);
  });
});

describe('adaptive back-off', () => {
  it('halves on each throttle down to the floor', () => {
    expect(afterThrottle(1)).toBe(0.5);
    expect(afterThrottle(0.5)).toBe(0.25);
    expect(afterThrottle(0.25)).toBe(MIN_SPEED_FACTOR);
    expect(afterThrottle(MIN_SPEED_FACTOR)).toBe(MIN_SPEED_FACTOR);
  });

  it('wins the speed back linearly and never passes full speed', () => {
    expect(recoveredFactor(0.2, 0)).toBe(0.2);
    expect(recoveredFactor(0.2, RECOVERY_MS / 2)).toBeCloseTo(0.6);
    expect(recoveredFactor(0.2, RECOVERY_MS)).toBe(1);
    expect(recoveredFactor(0.9, RECOVERY_MS * 10)).toBe(1);
  });
});

describe('tierState', () => {
  const tier = parseTier('TIER_1K');
  it('is ok below the warning line, warn at it, full at the cap', () => {
    expect(tierState(tier, 100, 80)).toEqual({ state: 'ok', pct: 10 });
    expect(tierState(tier, 800, 80)).toEqual({ state: 'warn', pct: 80 });
    expect(tierState(tier, 1000, 80)).toEqual({ state: 'full', pct: 100 });
    expect(tierState(tier, 1500, 80).state).toBe('full');
  });

  it('has no percentage for unlimited or unknown tiers', () => {
    expect(tierState(parseTier('TIER_UNLIMITED'), 5_000_000, 80)).toEqual({
      state: 'unlimited',
      pct: null,
    });
    expect(tierState(parseTier(null), 10, 80)).toEqual({ state: 'unknown', pct: null });
  });
});

describe('time helpers', () => {
  it('counts the time to the next hour boundary', () => {
    const t = Date.UTC(2026, 9, 18, 13, 45, 0);
    expect(msUntilNextHour(t)).toBe(15 * 60_000);
    expect(hourBucket(t + 15 * 60_000)).toBe(hourBucket(t) + 1);
  });

  it('notices a throughput upgrade', () => {
    expect(throughputChanged({ level: 'STANDARD', mps: 80 }, { level: 'HIGH', mps: 1000 })).toBe(
      true,
    );
    expect(throughputChanged({ level: 'HIGH', mps: 1000 }, { level: 'HIGH', mps: 1000 })).toBe(
      false,
    );
  });
});
