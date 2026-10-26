import { CappedMap } from './capped-map';

/**
 * An in-process cache for a lookup that is hot and slow to repeat: entries expire by age, the map is bounded (the key may come
 * from an unauthenticated body, so it cannot grow with what a caller sends), and callers asking for the same missing key at the same
 * moment share one load instead of each taking a database connection. A failed load is never cached.
 */
export class TtlCache<V> {
  private readonly entries: CappedMap<string, { at: number; value: V }>;
  private readonly loading = new Map<string, Promise<V>>();

  constructor(
    private readonly ttlMs: number,
    max: number,
    private readonly now: () => number = Date.now,
  ) {
    this.entries = new CappedMap(max);
  }

  /** `cacheIf` keeps a result out of the cache when it is a placeholder the next call should re-resolve rather than reuse. */
  async get(
    key: string,
    load: () => Promise<V>,
    cacheIf: (value: V) => boolean = () => true,
  ): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const inflight = this.loading.get(key);
    if (inflight) return inflight;
    const p = load()
      .then((value) => {
        if (cacheIf(value)) this.entries.set(key, { at: this.now(), value });
        return value;
      })
      .finally(() => {
        this.loading.delete(key);
      });
    this.loading.set(key, p);
    return p;
  }

  clear(): void {
    this.entries.clear();
  }
}
