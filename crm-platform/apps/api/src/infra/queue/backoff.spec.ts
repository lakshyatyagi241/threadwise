import { describe, expect, it } from 'vitest';
import { exponentialDelayMs, providerWaitMs, retryAfterMs } from './backoff';

describe('exponentialDelayMs', () => {
  it('stays within [half, full] of the capped exponential delay over many draws', () => {
    for (const [attempt, full] of [
      [1, 2_000],
      [2, 4_000],
      [5, 32_000],
      [20, 60_000],
    ] as const) {
      for (let i = 0; i < 2_000; i++) {
        const d = exponentialDelayMs(2_000, attempt, 60_000);
        expect(d).toBeGreaterThanOrEqual(full / 2);
        expect(d).toBeLessThanOrEqual(full);
      }
    }
  });

  it('is the lower bound at random 0 and just under the full delay at random ~1', () => {
    expect(exponentialDelayMs(2_000, 3, 60_000, 0.5, () => 0)).toBe(4_000);
    expect(exponentialDelayMs(2_000, 3, 60_000, 0.5, () => 0.999999)).toBe(7_999);
  });
});

describe('providerWaitMs', () => {
  it('never waits less than the provider asked, and never more than the cap', () => {
    for (let i = 0; i < 2_000; i++) {
      const d = providerWaitMs(10_000, 3_600_000);
      expect(d).toBeGreaterThanOrEqual(10_000);
      expect(d).toBeLessThanOrEqual(12_500);
    }
    expect(providerWaitMs(5_000_000, 3_600_000, () => 0.9)).toBe(3_600_000);
  });
});

describe('retryAfterMs', () => {
  const now = Date.parse('2026-10-18T08:00:00Z');
  it('reads whole seconds and HTTP dates, and ignores anything else', () => {
    expect(retryAfterMs('120', now)).toBe(120_000);
    expect(retryAfterMs(['5'], now)).toBe(5_000);
    expect(retryAfterMs('Sun, 18 Oct 2026 08:01:00 GMT', now)).toBe(60_000);
    for (const v of [undefined, '', '0', '-3', 'soon', 'Sun, 18 Oct 2026 07:00:00 GMT'])
      expect(retryAfterMs(v, now), String(v)).toBeNull();
  });
});
