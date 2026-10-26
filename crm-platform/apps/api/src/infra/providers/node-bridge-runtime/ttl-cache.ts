/**
 * The cache shape Baileys asks for (its `CacheStore`), with a time limit and a size cap and no timer.
 *
 * Baileys builds five `NodeCache` per socket when none is given (its own four plus the signal-key store). Each one starts a
 * `setInterval` that nothing stops, so a socket that is ended (every reconnect, every restart of a device) stays in memory with
 * its caches and their keys for the life of the process. Giving the socket these instead leaves no timer behind: an entry
 * expires when it is read or when the cap pushes it out, and `flushAll` on `end()` drops the rest at once.
 */
export interface SocketCache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  del(key: string): void;
  flushAll(): void;
  readonly size: number;
}

export class TtlCache implements SocketCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get<T>(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set<T>(key: string, value: T): void {
    // Re-insert so the Map order is the write order: the oldest write is the first to go when the cap is hit.
    this.entries.delete(key);
    const now = this.now();
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    // One lifetime for every entry, so the Map order is also the expiry order: what has expired is at the front. Dropped here, so a
    // key that is never read again does not stay until the cap pushes it out.
    for (const [k, e] of this.entries) {
      if (e.expiresAt > now) break;
      this.entries.delete(k);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  del(key: string): void {
    this.entries.delete(key);
  }

  flushAll(): void {
    this.entries.clear();
  }
}
