import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  BREAKER_OPEN_MS,
  RateLimiter,
} from '../../../src/modules/platform-infrastructure/rate-limit/rate-limiter';

/** A Redis whose `eval` fails while `down` is true, and counts every call. */
function fakeRedis() {
  const state = { down: true, calls: 0 };
  const redis = {
    eval: vi.fn(async () => {
      state.calls += 1;
      if (state.down) throw new Error('Command timed out');
      return [1, 1, 30_000];
    }),
  };
  return { state, limiter: new RateLimiter(redis as unknown as Redis) };
}

describe('RateLimiter circuit breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('asks Redis once, then lets requests through without a call while the breaker is open', async () => {
    const { state, limiter } = fakeRedis();
    const first = await limiter.consume('k', 5, 60);
    expect(first.degraded).toBe(true);
    expect(first.allowed).toBe(true);
    for (let i = 1; i <= 20; i++) {
      vi.setSystemTime(i * 100);
      const r = await limiter.consume('k', 5, 60);
      expect(r).toMatchObject({ allowed: true, degraded: true });
    }
    expect(state.calls).toBe(1);
  });

  it('probes again after the breaker time, re-opens on failure, and closes on success', async () => {
    const { state, limiter } = fakeRedis();
    await limiter.consume('k', 5, 60);
    vi.setSystemTime(BREAKER_OPEN_MS);
    await limiter.consume('k', 5, 60); // probe: still down
    expect(state.calls).toBe(2);
    vi.setSystemTime(BREAKER_OPEN_MS + 1);
    await limiter.consume('k', 5, 60); // open again, no call
    expect(state.calls).toBe(2);

    state.down = false;
    vi.setSystemTime(2 * BREAKER_OPEN_MS);
    const probe = await limiter.consume('k', 5, 60);
    expect(probe.degraded).toBe(false);
    expect(state.calls).toBe(3);
    const next = await limiter.consume('k', 5, 60);
    expect(next.degraded).toBe(false);
    expect(state.calls).toBe(4);
  });

  it('sends only one probe while concurrent requests arrive after the breaker time', async () => {
    const { state, limiter } = fakeRedis();
    await limiter.consume('k', 5, 60);
    vi.setSystemTime(BREAKER_OPEN_MS + 5);
    const burst = await Promise.all(Array.from({ length: 10 }, () => limiter.consume('k', 5, 60)));
    expect(burst.every((r) => r.allowed && r.degraded)).toBe(true);
    expect(state.calls).toBe(2); // the first failure and ONE probe
  });
});
