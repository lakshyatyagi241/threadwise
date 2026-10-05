import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

const WINDOW_SECONDS = 60;
/** Requests per minute per client address, over every connection: a scanner cannot probe addresses at will. */
const PER_IP = 600;
/** Failed authentications per minute per connection: guessing a secret is not a thing a sender can do at speed. */
const AUTH_FAILURES_PER_KEY = 30;

/**
 * The throttles of the public delivery address: per client address, per connection (the recipe's `rateLimits.perMinute`), and on failed
 * authentications. Fixed windows on Redis, fail-open on a Redis error (the same trade the booking and sales-document throttles make:
 * refusing every sender because a cache is down is the worse outcome; the error is logged).
 */
@Injectable()
export class HookThrottle {
  private readonly logger = new Logger(HookThrottle.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

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
      this.logger.warn({ err }, 'marketplace hook throttle failed open');
      return { count: 1, retryAfter: WINDOW_SECONDS };
    }
  }

  private tooMany(retryAfter: number): AppError {
    return new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Too many requests. Try again in a moment.',
      HttpStatus.TOO_MANY_REQUESTS,
      [{ path: 'retryAfterSeconds', message: String(retryAfter) }],
    );
  }

  async checkIp(ip: string | undefined): Promise<void> {
    const r = await this.hit(`mkt:hook:ip:${ip ?? 'unknown'}`);
    if (r.count > PER_IP) throw this.tooMany(r.retryAfter);
  }

  async checkConnection(publicKey: string, perMinute: number): Promise<void> {
    const r = await this.hit(`mkt:hook:conn:${publicKey}`);
    if (r.count > perMinute) throw this.tooMany(r.retryAfter);
  }

  /** Counts a failed authentication; refuses further attempts for this connection once the budget is spent. */
  async authFailed(publicKey: string): Promise<void> {
    const r = await this.hit(`mkt:hook:authfail:${publicKey}`);
    if (r.count > AUTH_FAILURES_PER_KEY) throw this.tooMany(r.retryAfter);
  }
}
