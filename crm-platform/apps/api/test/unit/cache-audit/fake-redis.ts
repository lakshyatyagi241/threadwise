import { SET_UNLESS_INVALIDATED_LUA } from '../../../src/modules/auth/security/account-gate.service';

/**
 * A small in-memory stand-in for the ioredis client, with a clock the test controls and switches for the failures a cache must survive.
 * It implements only the commands the audited caches call, with Redis semantics for expiry (EX/PX/NX/XX/KEEPTTL, EXPIRE ... NX).
 * Lua (`eval`) is not emulated: the one cache that needs it (RBAC grants) is tested against a real Redis in rbac-real-redis.spec.ts.
 */
export class FakeClock {
  constructor(public t = 1_700_000_000_000) {}
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

interface Entry {
  value: string | Buffer;
  expiresAt: number | null;
}

export class FakeRedis {
  readonly store = new Map<string, Entry>();
  /** Every command name sent, in order, for assertions on round trips and on what was (not) written. */
  readonly calls: string[] = [];
  /** `true`: every command rejects, as ioredis does when the server is unreachable. */
  down = false;
  /** Command names that reject while everything else works (a failing EXPIRE, for instance). */
  failing = new Set<string>();
  /** Added to every command, in real milliseconds. */
  delayMs = 0;

  constructor(readonly clock: FakeClock = new FakeClock()) {}

  private async enter(cmd: string): Promise<void> {
    this.calls.push(cmd);
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.down || this.failing.has(cmd))
      throw new Error(`fake redis: ${cmd} failed (connection refused)`);
  }

  private live(key: string): Entry | undefined {
    const e = this.store.get(key);
    if (e && e.expiresAt !== null && e.expiresAt <= this.clock.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  /** Remaining time to live in ms: -2 when the key is absent, -1 when it never expires (like PTTL). */
  pttlSync(key: string): number {
    const e = this.live(key);
    if (!e) return -2;
    return e.expiresAt === null ? -1 : e.expiresAt - this.clock.now();
  }

  keysSync(): string[] {
    return [...this.store.keys()].filter((k) => this.live(k));
  }

  async get(key: string): Promise<string | null> {
    await this.enter('get');
    const v = this.live(key)?.value;
    return v === undefined ? null : String(v);
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    await this.enter('getBuffer');
    const v = this.live(key)?.value;
    return v === undefined ? null : Buffer.from(v);
  }

  async mget(...args: Array<string | string[]>): Promise<Array<string | null>> {
    await this.enter('mget');
    const keys = args.flat();
    return keys.map((k) => {
      const v = this.live(k)?.value;
      return v === undefined ? null : String(v);
    });
  }

  async exists(key: string): Promise<number> {
    await this.enter('exists');
    return this.live(key) ? 1 : 0;
  }

  async set(
    key: string,
    value: string | Buffer,
    ...opts: Array<string | number>
  ): Promise<'OK' | null> {
    await this.enter('set');
    return this.setSync(key, value, opts);
  }

  private setSync(key: string, value: string | Buffer, opts: Array<string | number>): 'OK' | null {
    const o = opts.map((x) => (typeof x === 'string' ? x.toUpperCase() : x));
    const prev = this.live(key);
    if (o.includes('NX') && prev) return null;
    if (o.includes('XX') && !prev) return null;
    let expiresAt: number | null = null;
    const ex = o.indexOf('EX');
    const px = o.indexOf('PX');
    if (ex >= 0) expiresAt = this.clock.now() + Number(o[ex + 1]) * 1000;
    else if (px >= 0) expiresAt = this.clock.now() + Number(o[px + 1]);
    else if (o.includes('KEEPTTL') && prev) expiresAt = prev.expiresAt;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string | Buffer): Promise<'OK'> {
    await this.enter('setex');
    this.setSync(key, value, ['EX', seconds]);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    await this.enter('del');
    return keys.filter((k) => this.store.delete(k)).length;
  }

  async unlink(...keys: string[]): Promise<number> {
    await this.enter('unlink');
    return keys.filter((k) => this.store.delete(k)).length;
  }

  async incr(key: string): Promise<number> {
    await this.enter('incr');
    return this.incrSync(key);
  }

  private incrSync(key: string): number {
    const e = this.live(key);
    const n = Number(e?.value ?? 0) + 1;
    this.store.set(key, { value: String(n), expiresAt: e?.expiresAt ?? null });
    return n;
  }

  async expire(key: string, seconds: number, mode?: string): Promise<number> {
    await this.enter('expire');
    return this.expireSync(key, seconds, mode);
  }

  private expireSync(key: string, seconds: number, mode?: string): number {
    const e = this.live(key);
    if (!e) return 0;
    if (mode === 'NX' && e.expiresAt !== null) return 0;
    e.expiresAt = this.clock.now() + seconds * 1000;
    return 1;
  }

  /**
   * Lua is not emulated, with one exception: the gate's "set unless invalidated" script, whose logic is four lines (see
   * SET_UNLESS_INVALIDATED_LUA in account-gate.service.ts; the real script runs against a real Redis in the cache-invalidation specs).
   */
  async eval(script: string, _n: number, ...a: string[]): Promise<number> {
    await this.enter('eval');
    if (script !== SET_UNLESS_INVALIDATED_LUA) throw new Error('fake redis: Lua is not emulated');
    const [key, genKey, allKey, seenUser, seenAll, ttl, json] = a as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (
      (this.live(genKey)?.value ?? '') !== seenUser ||
      (this.live(allKey)?.value ?? '') !== seenAll
    )
      return 0;
    this.setSync(key, json, ['EX', Number(ttl)]);
    return 1;
  }

  async scan(cursor: string, _match: 'MATCH', pattern: string): Promise<[string, string[]]> {
    await this.enter('scan');
    const re = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    return ['0', this.keysSync().filter((k) => re.test(k))];
  }

  /** MULTI/EXEC: the queued commands run together or not at all (a `down` server fails the whole transaction). */
  multi(): FakeMulti {
    return new FakeMulti(this);
  }

  /** @internal used by FakeMulti */
  async runBatch(ops: Array<[string, unknown[]]>): Promise<Array<[Error | null, unknown]>> {
    await this.enter('exec');
    return ops.map(([cmd, args]) => {
      if (cmd === 'del') {
        for (const k of args as string[]) this.store.delete(k);
        return [null, 1];
      }
      if (cmd === 'incr') return [null, this.incrSync(args[0] as string)];
      if (cmd === 'expire')
        return [
          null,
          this.expireSync(args[0] as string, args[1] as number, args[2] as string | undefined),
        ];
      return [new Error(`fake redis: ${cmd} not supported in multi`), null];
    });
  }
}

class FakeMulti {
  private readonly ops: Array<[string, unknown[]]> = [];
  constructor(private readonly r: FakeRedis) {}
  del(...keys: string[]): this {
    this.ops.push(['del', keys]);
    return this;
  }
  incr(key: string): this {
    this.ops.push(['incr', [key]]);
    return this;
  }
  expire(key: string, seconds: number, mode?: string): this {
    this.ops.push(['expire', [key, seconds, mode]]);
    return this;
  }
  exec(): Promise<Array<[Error | null, unknown]>> {
    return this.r.runBatch(this.ops);
  }
}
