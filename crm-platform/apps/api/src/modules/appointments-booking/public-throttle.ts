import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { hashToken } from './appointment-rules';

/**
 * The throttle of the customer's public routes (EXT-APPT-01, D-19). Reference allowed 60 requests a minute per IP on the manage pages and
 * nothing at all on its payment callback. Here each route class has its own budget per IP AND per target (a booking page, or a manage
 * link), so one IP cannot exhaust a page for everybody and one link cannot be hammered from many IPs.
 *
 * Booking is the expensive and the abusable one (it can create a contact), so it is the tightest.
 *
 * Fixed windows on Redis, fail-open on a Redis error (the same trade the sales-document links and the auth throttles make: refusing every
 * customer because a cache is down is the worse outcome; the error is logged).
 */
const LIMITS = {
  /** Browsing a page and its slots. */
  browse: { ip: 120, target: 240 },
  /** Making a booking. */
  book: { ip: 10, target: 60 },
  /** Looking at a manage page and its slots. */
  manageRead: { ip: 120, target: 60 },
  /** Rescheduling or cancelling through a manage link. */
  manageWrite: { ip: 20, target: 10 },
} as const;
const WINDOW_SECONDS = 60;

export type ThrottleKind = keyof typeof LIMITS;

@Injectable()
export class BookingPublicThrottle {
  private readonly logger = new Logger(BookingPublicThrottle.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** `target` is a page (`slug/type`) or a secret (a manage token, hashed before it is used as a key). */
  async check(
    kind: ThrottleKind,
    ip: string | undefined,
    target: string,
    secret = false,
  ): Promise<void> {
    const limits = LIMITS[kind];
    const id = secret ? hashToken(target).slice(0, 24) : target.slice(0, 120);
    const [byIp, byTarget] = await Promise.all([
      this.hit(`appt:pub:${kind}:ip:${ip ?? 'unknown'}`),
      this.hit(`appt:pub:${kind}:target:${id}`),
    ]);
    const over = byIp.count > limits.ip ? byIp : byTarget.count > limits.target ? byTarget : null;
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
      this.logger.warn({ err }, 'booking public throttle failed open');
      return { count: 1, retryAfter: WINDOW_SECONDS };
    }
  }
}
