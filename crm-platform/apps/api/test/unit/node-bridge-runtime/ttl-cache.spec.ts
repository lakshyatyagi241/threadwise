import { describe, expect, it } from 'vitest';
import { TtlCache } from '../../../src/infra/providers/node-bridge-runtime/ttl-cache';

describe('TtlCache (the socket caches, no timer)', () => {
  it('returns a value until its time is up, then forgets it', () => {
    let t = 1_000;
    const c = new TtlCache(5_000, 10, () => t);
    c.set('a', 1);
    t += 4_999;
    expect(c.get('a')).toBe(1);
    t += 1;
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it('drops expired entries on a write, even if they are never read again', () => {
    let t = 0;
    const c = new TtlCache(1_000, 100, () => t);
    c.set('a', 1);
    c.set('b', 2);
    t = 1_001;
    c.set('c', 3);
    expect(c.size).toBe(1);
  });

  it('drops the oldest write when the cap is passed, and a rewrite counts as new', () => {
    const c = new TtlCache(60_000, 3);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    c.set('a', 10); // a is now the newest
    c.set('d', 4); // b is the oldest
    expect(c.get('b')).toBeUndefined();
    expect([c.get('a'), c.get('c'), c.get('d')]).toEqual([10, 3, 4]);
    expect(c.size).toBe(3);
  });

  it('del removes one key and flushAll empties the cache', () => {
    const c = new TtlCache(60_000, 10);
    c.set('a', 1);
    c.set('b', 2);
    c.del('a');
    expect(c.get('a')).toBeUndefined();
    c.flushAll();
    expect(c.size).toBe(0);
  });

  it('starts no timer: a cache built and dropped leaves the active timers as they were', () => {
    const before = process.getActiveResourcesInfo().length;
    const made = Array.from({ length: 50 }, () => new TtlCache(1_000, 10));
    made.forEach((c) => c.set('k', 1));
    expect(process.getActiveResourcesInfo().length).toBe(before);
  });
});
