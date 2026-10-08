import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  DAY_S,
  DEVICE_CREATES_PER_ORG_PER_HOUR,
  HOUR_S,
  PAIRING_STARTS_PER_DEVICE_PER_HOUR,
  PAIRING_STARTS_PER_ORG_PER_DAY,
  windowVerdict,
} from './device-rules';

/**
 * The abuse limits of the personal-number devices API (spec 10.3): pairing starts per device and per workspace, and devices created per
 * workspace per hour. Fixed windows on Redis; a Redis error fails OPEN and is logged (refusing every pairing because a cache is down is the
 * worse outcome, and the runtime's own 60 s lock and the attempt record still hold). Every refusal is a stable code with `retryAfterS`.
 */
@Injectable()
export class DeviceLimits {
  private readonly logger = new Logger(DeviceLimits.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Counts one pairing start; throws 429 DEVICE_PAIRING_RATE_LIMITED when the device or the workspace is over its budget. */
  async pairingStart(orgId: number, deviceId: number): Promise<void> {
    const [device, org] = await Promise.all([
      this.hit(`wadev:pair:dev:${orgId}:${deviceId}`, HOUR_S, PAIRING_STARTS_PER_DEVICE_PER_HOUR),
      this.hit(`wadev:pair:org:${orgId}`, DAY_S, PAIRING_STARTS_PER_ORG_PER_DAY),
    ]);
    const over = !device.allowed ? device : !org.allowed ? org : null;
    if (over) {
      throw new AppError(
        ERROR_CODES.DEVICE_PAIRING_RATE_LIMITED,
        `Too many connection attempts. Try again in ${Math.ceil(over.retryAfterS / 60)} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
        [{ path: 'retryAfterS', message: String(over.retryAfterS) }],
      );
    }
  }

  /** Counts one device creation; throws 429 DEVICE_CREATE_RATE_LIMITED over 10 an hour per workspace. */
  async creation(orgId: number): Promise<void> {
    const v = await this.hit(`wadev:create:org:${orgId}`, HOUR_S, DEVICE_CREATES_PER_ORG_PER_HOUR);
    if (!v.allowed) {
      throw new AppError(
        ERROR_CODES.DEVICE_CREATE_RATE_LIMITED,
        'Too many numbers were added in the last hour. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        [{ path: 'retryAfterS', message: String(v.retryAfterS) }],
      );
    }
  }

  private async hit(
    key: string,
    windowS: number,
    limit: number,
  ): Promise<{ allowed: boolean; retryAfterS: number }> {
    try {
      const res = await this.redis.multi().incr(key).expire(key, windowS, 'NX').ttl(key).exec();
      const count = Number(res?.[0]?.[1] ?? 1);
      const ttl = Number(res?.[2]?.[1] ?? windowS);
      return windowVerdict(count, limit, ttl, windowS);
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'device limits failed open');
      return { allowed: true, retryAfterS: windowS };
    }
  }
}
