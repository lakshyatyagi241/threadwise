import { describe, expect, it } from 'vitest';
import { Registry } from './prometheus-text';
import {
  MAX_CACHES,
  cacheFamilies,
  cacheMetrics,
  cacheSeriesCount,
  cacheSize,
  readCacheCounts,
  setCacheSink,
} from './cache-metrics';

const render = () => {
  const r = new Registry({ service: 'api', instance: 'i-1' });
  for (const f of cacheFamilies) r.add(f);
  return r.render();
};

describe('cacheMetrics', () => {
  it('counts one outcome per call and renders Prometheus text with the cache label only', () => {
    const m = cacheMetrics('unit_demo');
    m.hit();
    m.hit();
    m.miss();
    m.error();
    expect(readCacheCounts('unit_demo')).toEqual({ hit: 2, miss: 1, error: 1 });
    const text = render();
    expect(text).toContain('# TYPE crm_cache_hits_total counter');
    expect(text).toContain(
      'crm_cache_hits_total{service="api",instance="i-1",cache="unit_demo"} 2',
    );
    expect(text).toContain(
      'crm_cache_misses_total{service="api",instance="i-1",cache="unit_demo"} 1',
    );
    expect(text).toContain(
      'crm_cache_errors_total{service="api",instance="i-1",cache="unit_demo"} 1',
    );
  });

  it('a handle created before any traffic already exports zeros, so increase() has a starting point', () => {
    cacheMetrics('unit_zero');
    expect(render()).toContain(
      'crm_cache_hits_total{service="api",instance="i-1",cache="unit_zero"} 0',
    );
  });

  it('size gauges are read at scrape time; a throwing reader drops only its own line', () => {
    let n = 3;
    cacheSize('unit_size', () => n);
    cacheSize('unit_size_bad', () => {
      throw new Error('boom');
    });
    expect(render()).toContain(
      'crm_cache_entries{service="api",instance="i-1",cache="unit_size"} 3',
    );
    n = 9;
    const text = render();
    expect(text).toContain('cache="unit_size"} 9');
    expect(text).not.toContain('unit_size_bad');
    expect(text).toContain('# TYPE crm_cache_entries gauge');
  });

  it('a sink that throws is swallowed on every outcome', () => {
    const m = cacheMetrics('unit_throw');
    setCacheSink({
      bump: () => {
        throw new Error('registry down');
      },
    });
    try {
      expect(() => {
        m.hit();
        m.miss();
        m.error();
      }).not.toThrow();
    } finally {
      setCacheSink(undefined);
    }
    expect(readCacheCounts('unit_throw')).toEqual({ hit: 0, miss: 0, error: 0 });
  });

  it('names that could carry an id are folded into `other`; the name set is capped', () => {
    for (const bad of ['', 'Workspace-42', 'org 7', 'a'.repeat(60), '1abc', "x'y"])
      cacheMetrics(bad).hit();
    expect(readCacheCounts('other').hit).toBe(6);
    const before = cacheSeriesCount();
    for (let i = 0; i < 10_000; i++) cacheMetrics(`ws_${i}`).hit();
    expect(cacheSeriesCount() - before).toBeLessThanOrEqual(MAX_CACHES * 3);
    expect(
      render()
        .split('\n')
        .filter((l) => l.startsWith('crm_cache_hits_total')).length,
    ).toBeLessThanOrEqual(MAX_CACHES + 1);
  });
});
