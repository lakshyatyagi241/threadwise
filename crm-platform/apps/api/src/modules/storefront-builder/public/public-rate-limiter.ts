import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { incrWithTtl } from '../../../infra/redis/counter';

/** The per-client limits of the public routes (Reference's `throttle:N,1`), per minute. */
export const PUBLIC_LIMITS = {
  checkout: 20,
  coupon: 30,
  review: 10,
  abandon: 30,
  /** Not a Reference limit: the webhook and the host lookup are unauthenticated database reads. */
  webhook: 300,
  host: 300,
} as const;
export type PublicBucket = keyof typeof PUBLIC_LIMITS;

/**
 * A fixed one-minute window per client address and route (Laravel's throttle works the same way). A Redis outage never blocks
 * the shop: it is the protection that lapses, not the checkout.
 */
@Injectable()
export class PublicRateLimiter {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async hit(bucket: PublicBucket, ip: string): Promise<void> {
    try {
      const key = `store_rl:${bucket}:${ip}:${Math.floor(Date.now() / 60_000)}`;
      const n = await incrWithTtl(this.redis, key, 120);
      if (n > PUBLIC_LIMITS[bucket]) {
        throw new AppError(
          ERROR_CODES.RATE_LIMITED,
          'Too many requests. Please slow down.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
    }
  }
}
