import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';

/**
 * What to do when Redis cannot be reached and so nobody can say whether the lock is free.
 *
 * - `skip`     act as if somebody else holds it. The exclusive work does not run now. Right for anything where two runs
 *              would do harm (a sweeper, a send, a payout), and the caller retries on its next tick.
 * - `proceed`  act as if the lock were free and run unprotected. Right where the lock only saves effort, and refusing would
 *              lose something (dropping an inbound webhook because the dedupe store is down).
 *
 * There is deliberately no default. The two existing hand-rolled leases in this repo chose differently, and each was right
 * for its case; the choice has to be made where the work is understood.
 */
export type OnUnavailable = 'skip' | 'proceed';

export interface Lease {
  readonly key: string;
  /** Proves ownership: only the holder of this token can extend or release the key. */
  readonly token: string;
  /** False once a renewal found the lock gone or taken by another holder. Work that outlives its lease must stop. */
  readonly held: boolean;
  /** True when Redis was unreachable and the policy was `proceed`: this lease protects nothing. */
  readonly degraded: boolean;
  /** Pushes the expiry out to `ttlMs` from now (default: the original). False when the lock is no longer ours. */
  renew(ttlMs?: number): Promise<boolean>;
  /** Frees the lock if it is still ours. False when it had already expired or been taken over. Never throws. */
  release(): Promise<boolean>;
}

export interface AcquireOptions {
  /** How long the lock lives if the holder dies without releasing it. Choose a few times the work's normal duration. */
  ttlMs: number;
  onUnavailable: OnUnavailable;
}

export interface WaitOptions {
  /** Give up after this long and report `acquired: false`. */
  timeoutMs: number;
  /** Pause between attempts (default 50 ms, with jitter so waiters do not move in step). */
  retryMs?: number;
}

export interface WithLockOptions extends AcquireOptions {
  /**
   * How often to extend the lease while `fn` runs (default a third of the TTL). 0 turns the heartbeat off: the work must
   * then finish inside the TTL.
   */
  renewEveryMs?: number;
  /** Wait for a busy lock instead of giving up at once. */
  wait?: WaitOptions;
}

export interface LockedContext {
  /** Aborts when the lease is lost (taken over, or Redis unreachable for a full TTL). Pass it to anything cancellable. */
  signal: AbortSignal;
  lease: Lease;
}

export type LockResult<T> = { acquired: false } | { acquired: true; value: T; lost: boolean };

/** Compare-and-delete: free the lock only if the stored token is ours. */
const RELEASE = `
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
`;
/** Compare-and-extend: push the expiry out only if the stored token is ours. */
const RENEW = `
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end
`;

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive whole number of milliseconds, got ${value}`);
  }
}

/**
 * Mutual exclusion and once-only gates on Redis (TW-INFRA-025).
 *
 * Reference had no Redis and used `Cache::lock` / `Cache::add` on its database cache for about 200 things: sweeper exclusion,
 * double-send guards, webhook replay windows, "run at most every N seconds" gates. This repo already has at least five
 * hand-written versions of that (device lease, sender lease, dispatcher lock, webhook dedupe, init lock), and they disagree on
 * the details that matter: one releases with a plain GET-then-DEL, which can free a lock that has since passed to someone
 * else; one has no release at all; they split on what to do when Redis is down. This is the one version.
 *
 * Guarantees, and their limit: a held lease is exclusive among holders that use it, as long as work finishes (or renews)
 * within the TTL. It is NOT a fencing token. A holder paused for longer than the TTL (a long GC, a stalled VM) can wake up
 * believing it still holds the lock. Anything that must stay correct even then (money, stock) needs a database constraint
 * or row lock as well; this lock keeps duplicate work rare, it does not make it impossible.
 *
 * Keys are the caller's: use `<code>:<purpose>:<ids>` (for example `sched:sweep:42`) so two domains never collide, and do not
 * reuse a key that holds a counter or cached value.
 */
@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** The lease, or null when somebody else holds the lock (or Redis is down and the policy is `skip`). */
  async acquire(key: string, options: AcquireOptions): Promise<Lease | null> {
    assertPositiveInt('ttlMs', options.ttlMs);
    const token = randomUUID();
    try {
      const got = await this.redis.set(key, token, 'PX', options.ttlMs, 'NX');
      return got === 'OK' ? this.leaseFor(key, token, options.ttlMs) : null;
    } catch (err) {
      this.logger.warn({ err, key }, 'lock store unreachable');
      return options.onUnavailable === 'proceed' ? this.degradedLease(key, token) : null;
    }
  }

  /**
   * Runs `fn` while holding the lock and always releases it, even when `fn` throws (the error is rethrown).
   * Returns `{ acquired: false }` without running `fn` when the lock could not be taken.
   *
   * While `fn` runs the lease is extended every `renewEveryMs`, so the TTL only has to cover a dead holder, not the work.
   * If the lease is lost, `signal` aborts and the result carries `lost: true`: the work finished (or was abandoned) without
   * the lock, and the caller should treat what it did as unprotected.
   */
  async withLock<T>(
    key: string,
    options: WithLockOptions,
    fn: (context: LockedContext) => Promise<T>,
  ): Promise<LockResult<T>> {
    const renewEveryMs = options.renewEveryMs ?? Math.max(1, Math.floor(options.ttlMs / 3));
    if (options.renewEveryMs !== 0) assertPositiveInt('renewEveryMs', renewEveryMs);
    if (renewEveryMs >= options.ttlMs && options.renewEveryMs !== 0) {
      throw new RangeError(
        'renewEveryMs must be shorter than ttlMs, or the lease lapses between renewals',
      );
    }

    const lease = await this.acquireWithWait(key, options);
    if (!lease) return { acquired: false };

    const controller = new AbortController();
    let lost = false;
    let lastGoodAt = Date.now();
    let beating = false;
    const timer =
      options.renewEveryMs === 0 || lease.degraded
        ? undefined
        : setInterval(() => {
            if (beating) return;
            beating = true;
            lease
              .renew()
              .then((ok) => {
                if (ok) lastGoodAt = Date.now();
                else lost = true;
              })
              .catch(() => {
                // An unreachable store says nothing about who holds the lock; only a full TTL of silence counts as lost.
                if (Date.now() - lastGoodAt >= options.ttlMs) lost = true;
              })
              .finally(() => {
                beating = false;
                if (lost) {
                  clearInterval(timer);
                  controller.abort();
                }
              });
          }, renewEveryMs);
    timer?.unref();

    try {
      const value = await fn({ signal: controller.signal, lease });
      return { acquired: true, value, lost };
    } finally {
      clearInterval(timer);
      await lease.release();
    }
  }

  /**
   * True for the first caller within `ttlMs`, false for everyone after: a dedupe window or a "run at most every N" gate.
   * Nothing is ever released; the key simply expires. On a Redis error `onUnavailable` decides: `proceed` returns true.
   */
  async once(key: string, ttlMs: number, onUnavailable: OnUnavailable): Promise<boolean> {
    assertPositiveInt('ttlMs', ttlMs);
    try {
      return (await this.redis.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
    } catch (err) {
      this.logger.warn({ err, key }, 'gate store unreachable');
      return onUnavailable === 'proceed';
    }
  }

  private async acquireWithWait(key: string, options: WithLockOptions): Promise<Lease | null> {
    const first = await this.acquire(key, options);
    if (first || !options.wait) return first;

    const { timeoutMs, retryMs = 50 } = options.wait;
    assertPositiveInt('wait.timeoutMs', timeoutMs);
    assertPositiveInt('wait.retryMs', retryMs);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pause = Math.min(retryMs * (0.5 + Math.random()), Math.max(0, deadline - Date.now()));
      await new Promise((resolve) => setTimeout(resolve, pause));
      const lease = await this.acquire(key, options);
      if (lease) return lease;
    }
    return null;
  }

  private leaseFor(key: string, token: string, defaultTtlMs: number): Lease {
    const redis = this.redis;
    const logger = this.logger;
    let held = true;
    return {
      key,
      token,
      get held() {
        return held;
      },
      degraded: false,
      async renew(ttlMs = defaultTtlMs) {
        assertPositiveInt('ttlMs', ttlMs);
        const ok = Number(await redis.eval(RENEW, 1, key, token, ttlMs)) === 1;
        if (!ok) held = false;
        return ok;
      },
      async release() {
        held = false;
        try {
          return Number(await redis.eval(RELEASE, 1, key, token)) === 1;
        } catch (err) {
          // The key expires by itself; a failed release only delays the next holder by the TTL.
          logger.warn({ err, key }, 'lock release failed; it will expire');
          return false;
        }
      },
    };
  }

  private degradedLease(key: string, token: string): Lease {
    return {
      key,
      token,
      held: true,
      degraded: true,
      renew: async () => true,
      release: async () => true,
    };
  }
}
