import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { slidingWindow, type WindowVerdict } from './mail-rate-rules';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('mail_bounced_flag');

/**
 * Redis sliding-window counters and the bounced-address flags of the mail limits (TW-MAIL-032). A sorted set per key holds one entry per
 * hit, scored by time, so the window slides exactly (no fixed-hour cliff). Every method FAILS OPEN on a Redis error (a cache outage must
 * not stop a team from answering customers) and logs it.
 *
 * Keys: `mail:rl:<org>:<mailbox>` hourly sends of a mailbox, `mail:rr:<org>:<mailbox>:<address>` burst to one recipient,
 * `mail:fl:<org>:<mailbox>:<sender>` inbound flood per sender, `mail:bounced:<org>:<address>` a hard-bounced address.
 */
@Injectable()
export class MailLimits {
  private readonly logger = new Logger(MailLimits.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Would one more hit fit in the window? Does not count it. */
  async check(key: string, windowMs: number, limit: number): Promise<WindowVerdict> {
    try {
      const now = Date.now();
      await this.redis.zremrangebyscore(key, '-inf', now - windowMs);
      const hits = (await this.redis.zrangebyscore(key, '-inf', '+inf', 'WITHSCORES')).filter(
        (_, i) => i % 2 === 1,
      );
      return slidingWindow(hits.map(Number), now, windowMs, limit);
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'mail limits failed open');
      return { allowed: true, count: 0, retryAfterMs: 0 };
    }
  }

  /** Counts one hit. */
  async hit(key: string, windowMs: number): Promise<void> {
    try {
      const now = Date.now();
      await this.redis
        .multi()
        .zadd(key, now, `${now}:${randomUUID()}`)
        .pexpire(key, windowMs + 1_000)
        .exec();
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'mail limits failed open');
    }
  }

  /** Counts a hit and answers whether the count is now ABOVE the limit (the flood check of an inbound sender). */
  async hitAndCheck(key: string, windowMs: number, limit: number): Promise<boolean> {
    try {
      const now = Date.now();
      const res = await this.redis
        .multi()
        .zremrangebyscore(key, '-inf', now - windowMs)
        .zadd(key, now, `${now}:${randomUUID()}`)
        .zcard(key)
        .pexpire(key, windowMs + 1_000)
        .exec();
      return Number(res?.[2]?.[1] ?? 0) > limit;
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'mail limits failed open');
      return false;
    }
  }

  async flagBounced(orgId: number, address: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(this.bouncedKey(orgId, address), '1', 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'bounced address not flagged');
    }
  }

  /** The subset of `addresses` that hard-bounced recently. */
  async bouncedAmong(orgId: number, addresses: string[]): Promise<string[]> {
    if (addresses.length === 0) return [];
    try {
      const values = await this.redis.mget(addresses.map((a) => this.bouncedKey(orgId, a)));
      return addresses.filter((_, i) => {
        if (values[i] === null) cache.miss();
        else cache.hit();
        return values[i] !== null;
      });
    } catch (err) {
      cache.error();
      this.logger.warn({ err: String(err) }, 'mail limits failed open');
      return [];
    }
  }

  async clearBounced(orgId: number, address: string): Promise<void> {
    await this.redis.del(this.bouncedKey(orgId, address)).catch(() => undefined);
  }

  hourlyKey = (orgId: number, mailboxUuid: string) => `mail:rl:${orgId}:${mailboxUuid}`;
  recipientKey = (orgId: number, mailboxUuid: string, address: string) =>
    `mail:rr:${orgId}:${mailboxUuid}:${address.toLowerCase()}`;
  floodKey = (orgId: number, mailboxUuid: string, sender: string) =>
    `mail:fl:${orgId}:${mailboxUuid}:${sender.toLowerCase()}`;
  private bouncedKey = (orgId: number, address: string) =>
    `mail:bounced:${orgId}:${address.toLowerCase()}`;
}
