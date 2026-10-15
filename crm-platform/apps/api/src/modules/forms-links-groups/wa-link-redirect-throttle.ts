import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

/**
 * Per-address rate limit for the public link redirect (`GET /l/:slug`, TW-WFL-017 port note): unauthenticated and
 * writes on every hit, which Reference does not guard against. Fixed window on Redis, fail-open on a Redis error — a
 * down cache must not take the redirect offline.
 */
const WINDOW_SECONDS = 60;
const LIMIT = 120;

@Injectable()
export class WaLinkRedirectThrottle {
  private readonly logger = new Logger(WaLinkRedirectThrottle.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** `true` when the address is still under budget. */
  async allow(ip: string | undefined): Promise<boolean> {
    try {
      const key = `wfl:link:redirect:${ip ?? 'unknown'}`;
      // INCR and EXPIRE NX in one pipeline: a crash between two separate calls would otherwise leave the key
      // with no TTL, permanently capping the address instead of resetting it every window.
      const [[, count]] = (await this.redis
        .multi()
        .incr(key)
        .expire(key, WINDOW_SECONDS, 'NX')
        .exec()) as [[Error | null, number], [Error | null, number]];
      return count <= LIMIT;
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'link redirect throttle check failed, failing open');
      return true;
    }
  }
}
