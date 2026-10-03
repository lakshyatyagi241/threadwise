import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

/** WaDesk's `throttle:60,1` on message and `throttle:120,1` on history; config, embed and chat have none. */
export const WIDGET_LIMITS_PER_MINUTE = { message: 60, history: 120 } as const;
export type ThrottledRoute = keyof typeof WIDGET_LIMITS_PER_MINUTE;

/**
 * Per-minute counters in Redis.
 *
 * QUIRK: reproduced deliberately (WD-WGT-022 rule 2). Laravel keyed guest throttles by `domain|IP`, not by route or token, so
 * ONE counter per client address is shared by the message and history routes of every widget; the limit applied to a request
 * is its own route's. Visitors behind one NAT share it. Redis being down must not take the widget down with it.
 */
@Injectable()
export class WidgetThrottleService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** True while the caller is within the limit for `route`. */
  async allow(route: ThrottledRoute, ip: string): Promise<boolean> {
    const key = `wgt:hits:${ip}:${Math.floor(Date.now() / 60_000)}`;
    try {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 120);
      return n <= WIDGET_LIMITS_PER_MINUTE[route];
    } catch {
      return true;
    }
  }
}
