import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';

/**
 * After a Redis failure, how long requests skip Redis altogether. Without it every throttled request waits out the Redis command
 * timeout (2 s) before failing open, so an outage would make every login and public form two seconds slower.
 */
export const BREAKER_OPEN_MS = 5_000;

export interface ConsumeResult {
  allowed: boolean;
  limit: number;
  /** Requests left in the window after this one (0 when refused). */
  remaining: number;
  /** Whole seconds until a refused caller can try again, and until the window rolls. At least 1. */
  retryAfterSeconds: number;
  /** True when Redis could not be reached and the request was let through unchecked. */
  degraded: boolean;
}

/**
 * Two adjacent fixed windows, weighted by how far into the current one we are. The estimate is
 * `previous * (1 - elapsed/window) + current`; it removes the fixed window's burst at the boundary (up to 2x the limit
 * across a rollover) for two reads and one write, in one atomic script, with no per-request memory like a sorted-set log.
 *
 * A refused request is NOT counted. A client that honours `Retry-After` is let back in as the previous window decays; one
 * that keeps hammering stays refused without extending its own penalty forever.
 *
 * KEYS[1] current window, KEYS[2] previous window. ARGV: window ms, ms into the window, limit.
 * Returns {allowed (1/0), estimate used, ms to the end of this window}.
 */
const SLIDING_WINDOW = `
local win = tonumber(ARGV[1])
local elapsed = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local prev = tonumber(redis.call('GET', KEYS[2]) or '0')
local est = prev * (win - elapsed) / win + cur
if est >= limit then
  return {0, math.ceil(est), win - elapsed}
end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], win * 2)
return {1, math.ceil(est) + 1, win - elapsed}
`;

/**
 * Request counters on Redis.
 *
 * Fails OPEN: if Redis is down the request goes through and `degraded` is set. A throttle protects against abuse; turning a
 * cache outage into a full API outage is the worse trade. The failure is logged at most once every 30 s per process so an
 * outage does not also flood the log.
 *
 * Circuit breaker: the first failure opens it for `BREAKER_OPEN_MS`; requests in that time are let through at once without a
 * Redis call. Then ONE request probes Redis (the others keep skipping while it is out); success closes the breaker, failure
 * re-opens it. So an outage costs each request nothing instead of the 2 s command timeout.
 *
 * Clock: the window index comes from this process's clock. Skew between pods shifts a boundary by the skew, which at a
 * one-minute window is noise.
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);
  private lastWarnAt = 0;
  private open = false;
  private reopenAt = 0;
  private probing = false;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Count one request against `key` and say whether it may proceed. `nowMs` is for tests. */
  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
    nowMs: number = Date.now(),
  ): Promise<ConsumeResult> {
    const windowMs = windowSeconds * 1000;
    const index = Math.floor(nowMs / windowMs);
    const elapsed = nowMs - index * windowMs;
    let probe = false;
    if (this.open) {
      if (Date.now() < this.reopenAt || this.probing) return this.degraded(limit, windowSeconds);
      this.probing = probe = true;
    }
    try {
      const raw = (await this.redis.eval(
        SLIDING_WINDOW,
        2,
        `${key}:${index}`,
        `${key}:${index - 1}`,
        windowMs,
        elapsed,
        limit,
      )) as [number, number, number];
      const [allowed, used, msLeft] = raw;
      if (this.open) this.logger.log('rate limiter reached Redis again; counting requests');
      this.open = false;
      return {
        allowed: allowed === 1,
        limit,
        remaining: Math.max(0, limit - used),
        retryAfterSeconds: Math.max(1, Math.ceil(msLeft / 1000)),
        degraded: false,
      };
    } catch (err) {
      this.open = true;
      this.reopenAt = Date.now() + BREAKER_OPEN_MS; // wall clock: `nowMs` only picks the window, and tests freeze it
      if (nowMs - this.lastWarnAt > 30_000) {
        this.lastWarnAt = nowMs;
        this.logger.warn({ err }, 'rate limiter could not reach Redis; letting requests through');
      }
      return this.degraded(limit, windowSeconds);
    } finally {
      if (probe) this.probing = false;
    }
  }

  private degraded(limit: number, windowSeconds: number): ConsumeResult {
    return {
      allowed: true,
      limit,
      remaining: limit,
      retryAfterSeconds: windowSeconds,
      degraded: true,
    };
  }
}
