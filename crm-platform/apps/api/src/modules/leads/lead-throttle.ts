import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

/**
 * The public lead hook's throttle. Two budgets per minute, both checked on every call:
 *  - per IP: one address cannot hammer the door, whichever tokens it tries (checked BEFORE the token is looked up, so a scan with random
 *    tokens costs a Redis hit, not a database query);
 *  - per token: one source cannot flood a workspace, whatever addresses it comes from (an ad platform posts from many).
 *
 * The token budget is the higher of the two because a campaign launch is a real burst from a few big senders, while one IP trying many
 * tokens is never legitimate. Fixed windows on Redis, fail-open on a Redis error (the same trade the booking and sales-document
 * throttles make: dropping every lead because a cache is down is the worse outcome; the error is logged).
 */
export const LEAD_HOOK_LIMITS = { ip: 120, token: 600 } as const;
const WINDOW_SECONDS = 60;

@Injectable()
export class LeadHookThrottle {
  private readonly logger = new Logger(LeadHookThrottle.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** The address budget; call it first. */
  async checkIp(ip: string | undefined): Promise<void> {
    const hit = await this.hit(`lead:hook:ip:${ip ?? 'unknown'}`);
    if (hit.count > LEAD_HOOK_LIMITS.ip) this.refuse(hit.retryAfter);
  }

  /** The source budget, keyed by the token's hash (the token itself never goes into a cache key). */
  async checkToken(tokenHash: string): Promise<void> {
    const hit = await this.hit(`lead:hook:token:${tokenHash.slice(0, 24)}`);
    if (hit.count > LEAD_HOOK_LIMITS.token) this.refuse(hit.retryAfter);
  }

  private refuse(retryAfter: number): never {
    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Too many requests. Try again in a moment.',
      HttpStatus.TOO_MANY_REQUESTS,
      [{ path: 'retryAfterSeconds', message: String(retryAfter) }],
    );
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
      this.logger.warn({ err }, 'lead hook throttle failed open');
      return { count: 1, retryAfter: WINDOW_SECONDS };
    }
  }
}
