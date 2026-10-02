import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

/** The limits of WaDesk's `throttle:60,1` on message and `throttle:120,1` on history; config had none. */
export const WIDGET_LIMITS_PER_MINUTE = { message: 60, history: 120, config: 120 } as const;
export type ThrottledRoute = keyof typeof WIDGET_LIMITS_PER_MINUTE;

/**
 * Per-minute counters in Redis, keyed by client address and widget token. WaDesk keyed by address alone and shared one
 * counter across every route and every site behind the same address; scoping by token keeps one busy site from locking
 * out another, and the message and history routes still share one counter per site and address.
 */
@Injectable()
export class WidgetThrottleService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** True while the caller is within the limit for `route`. Redis being down must not take the widget down with it. */
  async allow(route: ThrottledRoute, ip: string, token: string): Promise<boolean> {
    const bucket = route === 'config' ? 'config' : 'chat';
    const key = `wgt:hits:${bucket}:${token}:${ip}:${Math.floor(Date.now() / 60_000)}`;
    try {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 120);
      return n <= WIDGET_LIMITS_PER_MINUTE[route];
    } catch {
      return true;
    }
  }
}
