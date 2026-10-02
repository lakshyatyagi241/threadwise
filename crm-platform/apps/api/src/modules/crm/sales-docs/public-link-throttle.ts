import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { hashToken } from './sales-doc-rules';

/**
 * The throttle of the buyer's public routes (TW-PROP-018): Reference allowed 120 requests a minute per IP for the quote, invoice and
 * brief pages together, and nothing per document. Here each route class has its own budget per IP AND per link, so one IP cannot
 * exhaust the buyer's page for everybody and one link cannot be hammered from many IPs.
 *
 * Fixed windows on Redis, fail-open on a Redis error (the same trade the auth throttles make: refusing every buyer because a cache is
 * down is the worse outcome; the error is logged).
 */
const LIMITS = {
  read: { ip: 120, link: 60 },
  decide: { ip: 20, link: 10 },
} as const;
const WINDOW_SECONDS = 60;

@Injectable()
export class PublicLinkThrottle {
  private readonly logger = new Logger(PublicLinkThrottle.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async check(kind: keyof typeof LIMITS, ip: string | undefined, token: string): Promise<void> {
    const limits = LIMITS[kind];
    const linkKey = `salesdoc:pub:${kind}:link:${hashToken(token).slice(0, 24)}`;
    const ipKey = `salesdoc:pub:${kind}:ip:${ip ?? 'unknown'}`;
    const [byIp, byLink] = await Promise.all([this.hit(ipKey), this.hit(linkKey)]);
    const over = byIp.count > limits.ip ? byIp : byLink.count > limits.link ? byLink : null;
    if (over) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many requests. Try again in a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
        [{ path: 'retryAfterSeconds', message: String(over.retryAfter) }],
      );
    }
  }

  private async hit(key: string): Promise<{ count: number; retryAfter: number }> {
    try {
      const res = await this.redis
        .multi()
        .incr(key)
        .expire(key, WINDOW_SECONDS, 'NX')
        .ttl(key)
        .exec();
      const ttl = Number(res?.[2]?.[1] ?? WINDOW_SECONDS);
      return { count: Number(res?.[0]?.[1] ?? 1), retryAfter: ttl > 0 ? ttl : WINDOW_SECONDS };
    } catch (err) {
      this.logger.warn({ err }, 'public link throttle failed open');
      return { count: 1, retryAfter: WINDOW_SECONDS };
    }
  }
}
