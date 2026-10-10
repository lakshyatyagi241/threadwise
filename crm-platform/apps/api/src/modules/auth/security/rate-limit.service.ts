import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { onRedisFailure } from '../support/resilience';

export interface WindowResult {
  /** Hits in the current window, including this one. */
  count: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counters on Redis.
 *
 * On a Redis error the behaviour follows the platform's failure mode (support/resilience.ts): in production the
 * default is CLOSED (503, nothing is decided without the counters), elsewhere OPEN (carry on unthrottled, and log).
 * Either way the failure is reported once a minute so it can be alerted on.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Count a hit and return the window state. */
  async hit(key: string, windowSeconds: number): Promise<WindowResult> {
    try {
      const results = await this.redis
        .multi()
        .incr(key)
        .expire(key, windowSeconds, 'NX')
        .ttl(key)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 1);
      const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
      return { count, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
    } catch (err) {
      onRedisFailure('rate-limit.hit', err);
      this.logger.warn({ err }, 'rate-limit hit failed open');
      return { count: 1, retryAfterSeconds: windowSeconds };
    }
  }

  /** Current state without counting. */
  async peek(key: string): Promise<WindowResult> {
    try {
      const [count, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
      return { count: Number(count ?? 0), retryAfterSeconds: ttl > 0 ? ttl : 0 };
    } catch (err) {
      onRedisFailure('rate-limit.peek', err);
      this.logger.warn({ err }, 'rate-limit peek failed open');
      return { count: 0, retryAfterSeconds: 0 };
    }
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key).catch((err: unknown) => {
      this.logger.warn({ err }, 'rate-limit reset failed');
    });
  }

  /** True while under the cap; counts the attempt. */
  async allow(key: string, max: number, windowSeconds: number): Promise<boolean> {
    if (max <= 0) return true;
    const { count } = await this.hit(key, windowSeconds);
    return count <= max;
  }
}
