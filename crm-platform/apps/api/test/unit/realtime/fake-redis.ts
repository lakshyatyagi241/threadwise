/**
 * Just enough Redis for the realtime unit tests: strings with a TTL on a clock the test controls, counters, `GETDEL`, `MGET`,
 * pipelines, and a recorder for `PUBLISH` (what the socket.io emitter writes). Not a general fake.
 */
export class FakeRedis {
  now = 1_000_000;
  readonly published: Array<{ channel: string; message: unknown }> = [];
  private readonly values = new Map<string, { value: string; expiresAt: number | null }>();

  private live(key: string): string | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now) {
      this.values.delete(key);
      return undefined;
    }
    return entry.value;
  }

  advance(ms: number): void {
    this.now += ms;
  }

  /** Every key currently alive, for asserting what was (not) written. */
  keys(): string[] {
    return [...this.values.keys()].filter((k) => this.live(k) !== undefined);
  }

  async set(key: string, value: string, mode?: 'EX', seconds?: number): Promise<'OK'> {
    this.values.set(key, {
      value,
      expiresAt: mode === 'EX' && seconds ? this.now + seconds * 1000 : null,
    });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.live(key) ?? null;
  }

  async getdel(key: string): Promise<string | null> {
    const value = this.live(key) ?? null;
    this.values.delete(key);
    return value;
  }

  async mget(keys: string[]): Promise<Array<string | null>> {
    return keys.map((k) => this.live(k) ?? null);
  }

  incr(key: string): number {
    const next = Number(this.live(key) ?? 0) + 1;
    const prev = this.values.get(key);
    this.values.set(key, { value: String(next), expiresAt: prev?.expiresAt ?? null });
    return next;
  }

  expire(key: string, seconds: number): number {
    const entry = this.values.get(key);
    if (!entry) return 0;
    entry.expiresAt = this.now + seconds * 1000;
    return 1;
  }

  /** What the socket.io emitter calls for every event. */
  async publish(channel: string, message: unknown): Promise<number> {
    this.published.push({ channel, message });
    return 1;
  }

  pipeline() {
    const ops: Array<() => unknown> = [];
    const chain = {
      incr: (key: string) => (ops.push(() => this.incr(key)), chain),
      expire: (key: string, seconds: number) => (ops.push(() => this.expire(key, seconds)), chain),
      exec: async () => ops.map((op) => [null, op()] as [null, unknown]),
    };
    return chain;
  }
}
