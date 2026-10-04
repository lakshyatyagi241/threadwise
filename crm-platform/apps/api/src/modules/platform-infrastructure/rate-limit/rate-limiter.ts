import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';

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
 * Clock: the window index comes from this process's clock. Skew between pods shifts a boundary by the skew, which at a
 * one-minute window is noise.
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);
  private lastWarnAt = 0;

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
      return {
        allowed: allowed === 1,
        limit,
        remaining: Math.max(0, limit - used),
        retryAfterSeconds: Math.max(1, Math.ceil(msLeft / 1000)),
        degraded: false,
      };
    } catch (err) {
      if (nowMs - this.lastWarnAt > 30_000) {
        this.lastWarnAt = nowMs;
        this.logger.warn({ err }, 'rate limiter could not reach Redis; letting requests through');
      }
      return {
        allowed: true,
        limit,
        remaining: limit,
        retryAfterSeconds: windowSeconds,
        degraded: true,
      };
    }
  }
}
