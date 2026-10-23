import { describe, expect, it, vi } from 'vitest';
import { KnownNumbers } from './known-numbers';

const ids = { phones: ['p1'], wabas: ['w1'] };

describe('KnownNumbers', () => {
  it('knows the numbers and WABAs it loaded and nothing else', async () => {
    const k = new KnownNumbers(async () => ids);
    const s = (await k.snapshot())!;
    expect(s.has('p1', 'zzz')).toBe(true); // the phone id is enough
    expect(s.has('other', 'w1')).toBe(false); // a change that names a number is routed by that number alone
    expect(s.has(null, 'w1')).toBe(true); // a change with no number is routed by its WABA
    expect(s.has('other', 'other')).toBe(false);
    expect(s.has(null, null)).toBe(false);
  });

  it('loads once for a burst of callers and again only after the ttl', async () => {
    let t = 0;
    const load = vi.fn(async () => ids);
    const k = new KnownNumbers(load, 5_000, 5_000, () => t);
    await Promise.all([k.snapshot(), k.snapshot(), k.snapshot()]);
    expect(load).toHaveBeenCalledTimes(1);
    t = 4_999;
    await k.snapshot();
    expect(load).toHaveBeenCalledTimes(1);
    t = 5_000;
    await k.snapshot();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('can be asked for a younger index than its ttl, and then loads again', async () => {
    let t = 0;
    const load = vi.fn(async () => ids);
    const k = new KnownNumbers(load, 5_000, 5_000, () => t);
    await k.snapshot();
    t = 30;
    await k.snapshot(50);
    expect(load).toHaveBeenCalledTimes(1); // 30 ms old, 50 allowed
    t = 60;
    await k.snapshot(50);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('is null before its first successful load, so the caller treats every number as possibly known', async () => {
    const k = new KnownNumbers(async () => {
      throw new Error('db down');
    });
    expect(await k.snapshot()).toBeNull();
  });

  it('does not ask a database that is down once per call', async () => {
    let t = 0;
    const load = vi.fn().mockRejectedValue(new Error('db down'));
    const k = new KnownNumbers(load, 5_000, 5_000, () => t + 1);
    for (let i = 0; i < 5; i++) await k.snapshot();
    expect(load).toHaveBeenCalledTimes(1);
    t = 5_001;
    await k.snapshot();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps using the last index when a refresh fails, rather than forgetting every number', async () => {
    let t = 1;
    const load = vi.fn().mockResolvedValueOnce(ids).mockRejectedValue(new Error('db down'));
    const k = new KnownNumbers(load, 5_000, 5_000, () => t);
    await k.snapshot();
    t = 6_000;
    const s = (await k.snapshot())!;
    expect(load).toHaveBeenCalledTimes(2);
    expect(s.has('p1', null)).toBe(true);
  });
});
