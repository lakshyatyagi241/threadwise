import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';

export interface WindowResult {
  /** Hits in the current window, including this one. */
  count: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counters on Redis.
 *
 * Fail-open on a Redis error: throttles protect against abuse, and refusing
 * every login because the cache is down is a worse outcome than briefly
 * serving without a throttle. The error is logged so it is visible.
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
