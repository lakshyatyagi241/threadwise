import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('loads once inside the ttl and again after it', async () => {
    let t = 0;
    const cache = new TtlCache<number>(1000, 10, () => t);
    const load = vi.fn().mockResolvedValue(7);
    expect(await cache.get('a', load)).toBe(7);
    t = 999;
    expect(await cache.get('a', load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
    t = 1000;
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one load between concurrent callers of the same key', async () => {
    const cache = new TtlCache<number>(1000, 10);
    let release!: (v: number) => void;
    const load = vi.fn(() => new Promise<number>((r) => (release = r)));
    const a = cache.get('k', load);
    const b = cache.get('k', load);
    release(3);
    expect(await Promise.all([a, b])).toEqual([3, 3]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed load', async () => {
    const cache = new TtlCache<number>(1000, 10);
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(1);
    await expect(cache.get('k', load)).rejects.toThrow('down');
    expect(await cache.get('k', load)).toBe(1);
  });

  it('stays within its bound', async () => {
    const cache = new TtlCache<number>(1000, 2);
    const load = vi.fn().mockResolvedValue(1);
    await cache.get('a', load);
    await cache.get('b', load);
    await cache.get('c', load);
    await cache.get('a', load); // evicted, loads again
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('keeps a result out of the cache when cacheIf says so', async () => {
    const cache = new TtlCache<number>(1000, 10);
    const load = vi.fn().mockResolvedValue(0);
    await cache.get('k', load, (v) => v > 0);
    await cache.get('k', load, (v) => v > 0);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
