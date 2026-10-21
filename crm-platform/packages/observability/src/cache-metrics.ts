import { formatLabels, type Family, type Labels } from './prometheus-text';

/**
 * Hit / miss / error counters for caches (Sheet3 #65). One call per outcome: `const m = cacheMetrics('rbac_grants'); m.hit()`.
 * Hoist the handle (module or class field): it is a plain object. The only label is `cache`, and the set of names is capped
 * (`MAX_CACHES`): a name that is not `[a-z][a-z0-9_]{0,47}`, or that arrives after the cap, is counted under `other`, so a bug that
 * builds the name from a workspace id, user id or key cannot grow the series count. Instrumentation never throws into the cache path.
 */
export const MAX_CACHES = 128;
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const OVERFLOW = 'other';

export type CacheOutcome = 'hit' | 'miss' | 'error';
export interface CacheMetrics {
  hit(): void;
  miss(): void;
  error(): void;
}
/** Where counts go. Replaceable only so a test can prove a failing sink does not break a cache. */
export interface CacheSink {
  bump(cache: string, outcome: CacheOutcome): void;
}

interface Row {
  hit: number;
  miss: number;
  error: number;
}
const rows = new Map<string, Row>();
const sizes = new Map<string, () => number>();

const memorySink: CacheSink = {
  bump(cache, outcome) {
    const r = rows.get(cache);
    if (r) r[outcome] += 1;
  },
};
let sink: CacheSink = memorySink;

function labelFor(name: string): string {
  if (rows.has(name) || sizes.has(name)) return name;
  return NAME.test(name) && rows.size < MAX_CACHES ? name : OVERFLOW;
}

export function cacheMetrics(name: string): CacheMetrics {
  const cache = labelFor(name);
  // The series exist from the first scrape, so rate() and increase() have a starting point.
  if (!rows.has(cache)) rows.set(cache, { hit: 0, miss: 0, error: 0 });
  const bump = (o: CacheOutcome) => () => {
    try {
      sink.bump(cache, o);
    } catch {
      // metrics must never break a cache path
    }
  };
  return { hit: bump('hit'), miss: bump('miss'), error: bump('error') };
}

/** Entry count of a bounded in-process cache, read at scrape time (costs nothing between scrapes). */
export function cacheSize(name: string, read: () => number): void {
  sizes.set(labelFor(name), read);
}

class CacheFamily implements Family {
  readonly type: 'counter' | 'gauge';
  constructor(
    readonly name: string,
    readonly help: string,
    private readonly pick: (cache: string) => number | undefined,
    private readonly names: () => Iterable<string>,
  ) {
    this.type = name.endsWith('_total') ? 'counter' : 'gauge';
  }
  render(base: Labels): string[] {
    const out: string[] = [];
    for (const cache of this.names()) {
      let v: number | undefined;
      try {
        v = this.pick(cache);
      } catch {
        continue; // a failing size reader drops its own line, not the scrape
      }
      if (v !== undefined) out.push(`${this.name}${formatLabels(base, { cache })} ${v}`);
    }
    return out;
  }
}

export const cacheFamilies: Family[] = [
  new CacheFamily(
    'crm_cache_hits_total',
    'Cache lookups answered from the cache',
    (c) => rows.get(c)?.hit,
    () => rows.keys(),
  ),
  new CacheFamily(
    'crm_cache_misses_total',
    'Cache lookups that went to the source',
    (c) => rows.get(c)?.miss,
    () => rows.keys(),
  ),
  new CacheFamily(
    'crm_cache_errors_total',
    'Cache backend failures (the request fell back to the source)',
    (c) => rows.get(c)?.error,
    () => rows.keys(),
  ),
  new CacheFamily(
    'crm_cache_entries',
    'Entries held by a bounded in-process cache',
    (c) => sizes.get(c)?.(),
    () => sizes.keys(),
  ),
];

/** Test helpers. */
export function setCacheSink(next: CacheSink | undefined): void {
  sink = next ?? memorySink;
}
export function cacheSeriesCount(): number {
  return rows.size * 3 + sizes.size;
}
export function readCacheCounts(name: string): Row {
  return { ...(rows.get(name) ?? { hit: 0, miss: 0, error: 0 }) };
}
