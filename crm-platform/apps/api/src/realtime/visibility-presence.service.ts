import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REALTIME_VISIBILITY_TTL_MS } from '@crm/contracts';
import { REDIS_CLIENT } from '../infra/redis/redis.module';

const key = (orgId: number, userId: number) => `rt:vis:${orgId}:${userId}`;
/** The set itself is dropped this long after its last write, so an abandoned one never lingers. */
const SET_TTL_SECONDS = 120;

/**
 * "Does this person have a tab in front of them right now?" (BL-097, docs/specs/realtime-notifications.md section 18.4.)
 *
 * Each connected tab reports `{ visible }` over its socket on every change and about every 15 s while visible. A visible report is
 * remembered for 35 s in a sorted set per person (member = socket id, score = when it lapses); a hidden report, a disconnect, or silence
 * for 35 s takes the tab out. The browser-push sender asks `isVisible` and skips a person who has a fresh visible tab: their bell, badge
 * and toast already cover it, and an OS notification on top would only be noise.
 *
 * It is a hint, never the truth: every method swallows Redis failures. A failed write only means a push may be sent that was not
 * needed; a failed read answers "not visible", so a push is never lost to a Redis hiccup.
 */
@Injectable()
export class VisibilityPresence {
  private readonly logger = new Logger(VisibilityPresence.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** A tab reported its state. */
  async report(orgId: number, userId: number, socketId: string, visible: boolean): Promise<void> {
    try {
      if (visible) {
        await this.redis
          .multi()
          .zadd(key(orgId, userId), Date.now() + REALTIME_VISIBILITY_TTL_MS, socketId)
          .expire(key(orgId, userId), SET_TTL_SECONDS)
          .exec();
      } else {
        await this.redis.zrem(key(orgId, userId), socketId);
      }
    } catch (err) {
      this.logger.debug({ err }, 'could not record tab visibility');
    }
  }

  /** The tab's socket closed. */
  async clear(orgId: number, userId: number, socketId: string): Promise<void> {
    try {
      await this.redis.zrem(key(orgId, userId), socketId);
    } catch (err) {
      this.logger.debug({ err }, 'could not clear tab visibility');
    }
  }

  /** True when at least one of the person's tabs reported "visible" in the last 35 s. */
  async isVisible(orgId: number, userId: number): Promise<boolean> {
    try {
      const results = await this.redis
        .multi()
        .zremrangebyscore(key(orgId, userId), '-inf', Date.now())
        .zcard(key(orgId, userId))
        .exec();
      const count = results?.[1]?.[1];
      return typeof count === 'number' && count > 0;
    } catch {
      return false;
    }
  }
}
