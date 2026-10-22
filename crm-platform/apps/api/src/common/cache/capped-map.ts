/**
 * `Map#set` for an in-process cache: once the map holds `max` entries, the oldest one (by first insertion) goes before a new key comes
 * in, so a cache keyed by workspace or id cannot grow with the number of workspaces a process has ever served. Updating a key that is
 * already present never evicts. This is first-in-first-out, not least-recently-used: these caches also expire by age, so the oldest
 * entry is the one closest to expiring anyway.
 */
export function setCapped<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  if (!map.has(key) && map.size >= max) {
    const oldest = map.keys().next();
    if (!oldest.done) map.delete(oldest.value);
  }
  map.set(key, value);
}

/**
 * A `Map` that never holds more than `max` entries: `set` drops the oldest first (see `setCapped`). For a cache declared as a field
 * whose `set` calls are spread over several places, so the bound sits in one spot, the declaration.
 */
export class CappedMap<K, V> extends Map<K, V> {
  constructor(readonly max: number) {
    super();
  }

  override set(key: K, value: V): this {
    if (!this.has(key) && this.size >= this.max) {
      const oldest = this.keys().next();
      if (!oldest.done) this.delete(oldest.value);
    }
    return super.set(key, value);
  }
}
