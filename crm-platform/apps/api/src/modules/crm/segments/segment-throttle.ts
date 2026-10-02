import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';

/**
 * Per-user budget for the two routes that run an arbitrary rule over every contact: the preview
 * and the count refresh. A rule builder that re-previews on every keystroke, or a script, must not
 * be able to keep the database busy with counts.
 *
 * Fixed one-minute windows on Redis, fail-open on a Redis error (the same trade the other throttles
 * in this API make, the error is logged).
 */
export const SEGMENT_PREVIEW_PER_MINUTE = 30;
export const SEGMENT_REFRESH_PER_MINUTE = 20;

@Injectable()
export class SegmentThrottle {
  private readonly logger = new Logger(SegmentThrottle.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async check(kind: 'preview' | 'refresh', orgId: number, userId: number | null): Promise<void> {
    const max = kind === 'preview' ? SEGMENT_PREVIEW_PER_MINUTE : SEGMENT_REFRESH_PER_MINUTE;
    const key = `segments:rl:${kind}:${orgId}:${userId ?? 'none'}`;
    let count = 0;
    let ttl = 60;
    try {
      const res = await this.redis.multi().incr(key).expire(key, 60, 'NX').ttl(key).exec();
      count = Number(res?.[0]?.[1] ?? 1);
      ttl = Number(res?.[2]?.[1] ?? 60);
    } catch (err) {
      this.logger.warn({ err }, 'segment throttle failed open');
      return;
    }
    if (count > max) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many requests. Try again in a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
        [{ path: 'retryAfterSeconds', message: String(ttl > 0 ? ttl : 60) }],
      );
    }
  }
}
