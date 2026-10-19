import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

/**
 * The booking page's look, cached per workspace (BL-355). Every visit to a booking page needs it, and it changes a few times a year:
 * one small JSON value in Redis, dropped the moment staff save a theme or change a picture, and in any case after two minutes (the
 * workspace brand kit and the plan are read into it, and those are saved elsewhere).
 *
 * Fail-open: Redis being down means every visit reads the database, never a failed page.
 */
const TTL_SECONDS = 120;
const key = (orgId: number) => `appt:page-theme:v1:${orgId}`;

@Injectable()
export class BookingPageThemesCache {
  private readonly logger = new Logger(BookingPageThemesCache.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(orgId: number): Promise<T | null> {
    try {
      const raw = await this.redis.get(key(orgId));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'booking page theme cache read failed');
      return null;
    }
  }

  async set(orgId: number, value: unknown): Promise<void> {
    try {
      await this.redis.set(key(orgId), JSON.stringify(value), 'EX', TTL_SECONDS);
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'booking page theme cache write failed');
    }
  }

  async drop(orgId: number): Promise<void> {
    try {
      await this.redis.del(key(orgId));
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'booking page theme cache drop failed');
    }
  }
}
