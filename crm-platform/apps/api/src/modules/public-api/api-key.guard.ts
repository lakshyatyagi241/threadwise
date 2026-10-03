import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from '@node-rs/argon2';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import type { Request, Response } from 'express';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { SecurityPolicyService } from '../auth';
import { PlanEntitlementService, resolveLimit } from '../plans-subscriptions-trials';

interface ApiKeyRow {
  org_id: number;
  id: number;
  key_hash: string;
  signing_secret_enc: string;
  scopes: string[];
  status: string;
  expires_at: Date | null;
  rate_limit_per_minute: number;
}

/**
 * The limit a request is held to: the key's own limit, never above the platform
 * ceiling from the security policy (`apiRateLimitPerMinute`, 0 = no ceiling).
 * A key with no limit of its own gets the ceiling; neither set means unlimited.
 */
export function effectiveRateLimit(keyLimit: number, platformCeiling: number): number {
  const own = keyLimit > 0 ? keyLimit : Number.POSITIVE_INFINITY;
  const ceiling = platformCeiling > 0 ? platformCeiling : Number.POSITIVE_INFINITY;
  return Math.min(own, ceiling);
}

/**
 * Authentication for /public/v1.
 *
 * Three independent checks, in this order:
 *   1. API key     — `Authorization: ApiKey <prefix>.<secret>`, argon2-verified
 *   2. Signature   — HMAC-SHA256 over `timestamp.METHOD.path.body`
 *   3. Rate limit  — per key, per minute, in Redis
 *
 * Why a signature on top of a bearer secret: the key alone is replayable. Any
 * proxy, log line or browser extension that ever saw a request could repeat it
 * indefinitely. Binding the request to a timestamp and a body digest makes a
 * captured request useless once the window closes.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly securityPolicy: SecurityPolicyService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();

    const header = request.header('authorization');
    if (!header?.startsWith('ApiKey ')) {
      throw new AppError(ERROR_CODES.API_KEY_INVALID, 'Missing API key', 401);
    }

    const [prefix, secret] = header.slice('ApiKey '.length).trim().split('.');
    if (!prefix || !secret) {
      throw new AppError(ERROR_CODES.API_KEY_INVALID, 'Malformed API key', 401);
    }

    const key = await this.lookupKey(prefix);
    if (!key) {
      throw new AppError(ERROR_CODES.API_KEY_INVALID, 'Unknown API key', 401);
    }
    if (key.status !== 'active' || (key.expires_at && key.expires_at < new Date())) {
      throw new AppError(ERROR_CODES.API_KEY_INVALID, 'API key is revoked or expired', 401);
    }

    const secretOk = await verify(key.key_hash, secret).catch(() => false);
    if (!secretOk) {
      throw new AppError(ERROR_CODES.API_KEY_INVALID, 'Invalid API key', 401);
    }

    this.verifySignature(request, key);
    // The workspace's plan caps its keys (WD-PLAN-022); a plan with 0 (or no plan state) falls back to the platform ceiling, and a
    // workspace override of -1 lifts the limit altogether (WaDesk: 0 or -1 = unlimited on an override).
    const entitlements = await this.entitlements.forOrg(key.org_id).catch(() => null);
    const raw = entitlements?.overrides.limits?.api_rate_limit_per_minute;
    const unlimited = raw === -1;
    const planLimit = entitlements ? resolveLimit(entitlements, 'api_rate_limit_per_minute') : 0;
    const ceiling =
      planLimit > 0
        ? planLimit
        : await this.securityPolicy
            .policy()
            .then((p) => p.apiRateLimitPerMinute)
            .catch(() => 0);
    if (!unlimited) {
      await this.enforceRateLimit(
        request.res,
        prefix,
        effectiveRateLimit(key.rate_limit_per_minute, ceiling),
      );
    }

    const ctx = RequestContextStore.require();
    ctx.orgId = key.org_id;
    ctx.actorType = 'api_key';
    ctx.actorId = key.id;
    ctx.userId = null;

    // Fire and forget: last_used_at is diagnostics, not correctness, and it
    // must not add latency or a failure mode to every API call.
    void this.touchLastUsed(key.org_id, key.id);

    return true;
  }

  private verifySignature(request: Request & { rawBody?: Buffer }, key: ApiKeyRow): void {
    const signature = request.header('x-signature');
    const timestamp = request.header('x-timestamp');

    if (!signature || !timestamp) {
      throw new AppError(
        ERROR_CODES.SIGNATURE_INVALID,
        'Missing X-Signature or X-Timestamp header',
        401,
      );
    }

    const windowSeconds = this.config.get('PUBLIC_API_HMAC_WINDOW_SECONDS', { infer: true });
    const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(skew) || skew > windowSeconds) {
      throw new AppError(
        ERROR_CODES.SIGNATURE_EXPIRED,
        `Request timestamp outside the ${windowSeconds}s window`,
        401,
      );
    }

    const signingSecret = this.crypto.decrypt(key.signing_secret_enc);
    const body = request.rawBody?.toString('utf8') ?? '';
    const payload = `${timestamp}.${request.method.toUpperCase()}.${request.originalUrl}.${body}`;
    const expected = createHmac('sha256', signingSecret).update(payload).digest();

    let received: Buffer;
    try {
      received = Buffer.from(signature, 'hex');
    } catch {
      throw new AppError(ERROR_CODES.SIGNATURE_INVALID, 'Invalid signature', 401);
    }

    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new AppError(ERROR_CODES.SIGNATURE_INVALID, 'Invalid signature', 401);
    }
  }

  /**
   * Fixed-window counter in Redis. Cheaper than a sliding window and accurate
   * enough for abuse protection; a caller can burst across a window boundary
   * and that is an acceptable trade for one INCR per request.
   */
  private async enforceRateLimit(
    res: Response | undefined,
    prefix: string,
    limit: number,
  ): Promise<void> {
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `ratelimit:apikey:${prefix}:${bucket}`;

    if (!Number.isFinite(limit)) return;
    const count = await this.redis.incr(key).catch(() => 0);
    if (count === 1) {
      await this.redis.expire(key, 120).catch(() => undefined);
    }
    res?.setHeader('X-RateLimit-Limit', String(limit));
    res?.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
    if (count > limit) {
      res?.setHeader('Retry-After', String(60 - Math.floor((Date.now() % 60_000) / 1000)));
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        `Rate limit exceeded (${limit} requests/minute)`,
        429,
      );
    }
  }

  /**
   * Privileged by necessity: the prefix has to resolve to an org before any
   * tenant context can exist. This is one of the four sanctioned uses of
   * privileged mode (see 0007_rls_policies.sql).
   */
  private async lookupKey(prefix: string): Promise<ApiKeyRow | undefined> {
    const result = await this.db.privileged(async (tx) =>
      tx.execute(sql`
        SELECT org_id, id, key_hash, signing_secret_enc, scopes, status::text AS status,
               expires_at, rate_limit_per_minute
        FROM api_keys
        WHERE key_prefix = ${prefix}
        LIMIT 1
      `),
    );
    return result.rows[0] as unknown as ApiKeyRow | undefined;
  }

  private async touchLastUsed(orgId: number, id: number): Promise<void> {
    try {
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
