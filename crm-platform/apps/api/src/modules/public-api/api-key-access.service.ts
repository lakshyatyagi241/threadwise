import { ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { ERROR_CODES, type PlanFeatureKey } from '@crm/contracts';
import type { Response } from 'express';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { incrWithTtl } from '../../infra/redis/incr-with-ttl';
import { SecurityPolicyService } from '../auth';
import {
  PlanEntitlementService,
  REQUIRE_PLAN_FEATURE_KEY,
  planFeatureLabel,
  resolveLimit,
} from '../plans-subscriptions-trials';

/** Failed authentications one address may make per minute before it is refused with 429 (same number as the bearer-key guard). */
export const AUTH_FAILURES_PER_MINUTE = 30;

/**
 * The limit a request is held to: the key's own limit, never above the platform ceiling from the security policy
 * (`apiRateLimitPerMinute`, 0 = no ceiling). A key with no limit of its own gets the ceiling; neither set means unlimited.
 */
export function effectiveRateLimit(keyLimit: number, platformCeiling: number): number {
  const own = keyLimit > 0 ? keyLimit : Number.POSITIVE_INFINITY;
  const ceiling = platformCeiling > 0 ? platformCeiling : Number.POSITIVE_INFINITY;
  return Math.min(own, ceiling);
}

/**
 * What every API-key guard does after it has proved who the caller is: hold the key to its rate limit, enforce the plan feature the route
 * asks for, and note that the key was used. One implementation for the signed partner keys (`/public/v1`) and the bearer keys
 * (`/api/v1`), so the two cannot drift on a number that customers are told about.
 */
@Injectable()
export class ApiKeyAccessService {
  private readonly logger = new Logger(ApiKeyAccessService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly securityPolicy: SecurityPolicyService,
    private readonly entitlements: PlanEntitlementService,
    private readonly reflector: Reflector,
  ) {}

  /** One counter per address that lives 60 seconds from its first failure, so a burst cannot straddle a clock minute and escape. */
  private authFailureKey(scope: string, ip: string): string {
    return `apikey:authfail:${scope}:${ip}`;
  }

  /**
   * Failed-authentication throttle (TI-013): a caller guessing key prefixes or secrets gets AUTH_FAILURES_PER_MINUTE tries a minute
   * per address, then 429. A Redis outage does not lock anyone out (the counter reads as 0).
   */
  async assertNotLockedOut(scope: string, ip: string): Promise<void> {
    const failures = Number(await this.redis.get(this.authFailureKey(scope, ip)).catch(() => 0));
    if (failures >= AUTH_FAILURES_PER_MINUTE) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many failed authentication attempts. Try again in a minute.',
        429,
      );
    }
  }

  async recordAuthFailure(scope: string, ip: string): Promise<void> {
    const key = this.authFailureKey(scope, ip);
    await incrWithTtl(this.redis, key, 60).catch(() => undefined);
  }

  /**
   * The workspace's plan caps its keys (TW-PLAN-022); a plan with 0 (or no plan state) falls back to the platform ceiling, and a workspace
   * override of -1 lifts the limit altogether (Reference: 0 or -1 = unlimited on an override).
   */
  async enforceRateLimit(
    res: Response | undefined,
    bucketKey: string,
    orgId: number,
    keyLimit: number,
  ): Promise<void> {
    const entitlements = await this.entitlements.forOrg(orgId).catch(() => null);
    const raw = entitlements?.overrides.limits?.api_rate_limit_per_minute;
    if (raw === -1) return;
    const planLimit = entitlements ? resolveLimit(entitlements, 'api_rate_limit_per_minute') : 0;
    const ceiling =
      planLimit > 0
        ? planLimit
        : await this.securityPolicy
            .policy()
            .then((p) => p.apiRateLimitPerMinute)
            .catch(() => 0);
    await this.consume(res, bucketKey, effectiveRateLimit(keyLimit, ceiling));
  }

  /**
   * Fixed-window counter in Redis. Cheaper than a sliding window and accurate enough for abuse protection; a caller can burst across a
   * window boundary and that is an acceptable trade for one INCR per request. Redis down: the request goes through (and is logged by the
   * client), the same call the throttle guard makes.
   */
  private async consume(
    res: Response | undefined,
    bucketKey: string,
    limit: number,
  ): Promise<void> {
    if (!Number.isFinite(limit)) return;
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `ratelimit:apikey:${bucketKey}:${bucket}`;

    const count = await incrWithTtl(this.redis, key, 120).catch(() => 0);
    res?.setHeader('X-RateLimit-Limit', String(limit));
    res?.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
    if (count > limit) {
      const retryAfter = 60 - Math.floor((Date.now() % 60_000) / 1000);
      res?.setHeader('Retry-After', String(retryAfter));
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        `Rate limit of ${limit} requests/minute for your plan exceeded. Retry in ${retryAfter}s.`,
        429,
      );
    }
  }

  /**
   * `@RequirePlanFeature` on a key-authenticated controller. The app-wide PlanFeatureGuard runs BEFORE this controller-level guard, when
   * the request has no workspace yet (the route is `@Public()`), so it lets the call through; the key's workspace is only known here, so
   * the same decorator is enforced here once the key is verified (422 PLAN_FEATURE_LOCKED, the same problem the app-wide guard raises).
   */
  async assertPlanFeatures(context: ExecutionContext, orgId: number): Promise<void> {
    const keys = this.reflector.getAllAndOverride<PlanFeatureKey[] | undefined>(
      REQUIRE_PLAN_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    for (const feature of keys ?? []) {
      if (!(await this.entitlements.featureEnabled(orgId, feature))) {
        await this.entitlements.assertFeature(
          orgId,
          feature,
          `Your plan doesn't include ${planFeatureLabel(feature)}. Upgrade to unlock this feature.`,
        );
      }
    }
  }

  /**
   * `last_used_at` is diagnostics, not correctness: it must not add latency or a failure mode to every call. `minIntervalSeconds` lets a
   * guard write it at most that often per key (a hot key would otherwise rewrite one row on every request).
   */
  async touchLastUsed(orgId: number, id: number, minIntervalSeconds = 0): Promise<void> {
    try {
      if (minIntervalSeconds > 0) {
        const fresh = await this.redis.set(
          `apikey:touched:${orgId}:${id}`,
          '1',
          'EX',
          minIntervalSeconds,
          'NX',
        );
        if (fresh !== 'OK') return;
      }
      await this.db.txAs({ orgId }, async (tx) => {
        await tx.execute(
          sql`UPDATE api_keys SET last_used_at = now() WHERE org_id = ${orgId} AND id = ${id}`,
        );
      });
    } catch (err) {
      this.logger.warn({ err }, 'failed to update api_keys.last_used_at');
    }
  }
}
