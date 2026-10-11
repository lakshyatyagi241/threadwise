import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { ERROR_CODES, type ApiScope } from '@crm/contracts';
import type { Request } from 'express';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { ApiKeyAccessService } from '../../public-api';
import { SCOPE_PERMISSIONS, capGrantsToOwner, grantsForScopes } from './api-key-grants';
import { API_SCOPE_KEY, scopeAllows } from './api-scope';
import { keyPrefixOf, looksLikeRawKey, rawKeyMatches } from '../keys/api-key-secret';

interface BearerKeyRow {
  org_id: number;
  id: number;
  key_hash: string;
  scopes: string[];
  status: string;
  expires_at: Date | null;
  rate_limit_per_minute: number;
  user_id: number | null;
  owner_id: number | null;
}

/** Failed authentications one address may make in a minute before it is refused outright (WaDesk had no limit at all). */
export const AUTH_FAILURES_PER_MINUTE = 30;
/** A key's `last_used_at` is written at most this often (WaDesk wrote it on every call, one hot row per busy key). */
const LAST_USED_EVERY_SECONDS = 60;

/**
 * Authentication for `/api/v1` (WD-API-005): the workspace key as `Authorization: Bearer <key>` or `X-Api-Key`.
 *
 * The key resolves to its workspace and to the member who minted it; the request then runs as that workspace with `actorType = 'api_key'`.
 * It carries grants derived from its scopes (see `api-key-grants.ts`) because the services behind each route are the dashboard's own.
 *
 * Differences from WaDesk, all listed as intended in the parity file: a failed-authentication throttle per address, `last_used_at` at most
 * once a minute, scopes enforced when a key has any, and a constant-time compare of a sha256 digest looked up by prefix instead of by hash.
 */
@Injectable()
export class BearerApiKeyGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: ApiKeyAccessService,
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? 'unknown';

    await this.assertNotLockedOut(ip);

    const raw = this.tokenOf(request);
    if (!raw) {
      throw new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        'No API key provided. Send it as "Authorization: Bearer <key>".',
        401,
      );
    }

    const key = looksLikeRawKey(raw) ? await this.lookup(keyPrefixOf(raw)) : undefined;
    if (
      !key ||
      !rawKeyMatches(raw, key.key_hash) ||
      key.status !== 'active' ||
      (key.expires_at && new Date(key.expires_at) < new Date()) ||
      key.owner_id === null
    ) {
      await this.recordFailure(ip);
      throw new AppError(
        ERROR_CODES.API_KEY_INVALID,
        'The API key is missing, revoked or expired.',
        401,
      );
    }

    const required = this.reflector.getAllAndOverride<ApiScope | undefined>(API_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && !scopeAllows(key.scopes, required)) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        `This API key is not allowed to use this endpoint (needs the "${required}" scope).`,
        403,
      );
    }

    await this.access.enforceRateLimit(
      request.res,
      `v1:${key.id}`,
      key.org_id,
      key.rate_limit_per_minute,
    );

    const ctx = RequestContextStore.require();
    ctx.orgId = key.org_id;
    ctx.actorType = 'api_key';
    ctx.actorId = key.id;
    // The key acts as the member who minted it, so what it creates is theirs (WaDesk `user_id`).
    ctx.userId = key.owner_id;
    ctx.grants = capGrantsToOwner(
      grantsForScopes(key.scopes),
      await this.rbac.grantsForUser(key.org_id, key.owner_id),
    );
    // AZ-001: the resource services read grants only for record scope, so the key's reach is enforced here: the member the key acts as
    // must still hold every permission behind the route's scope. A key minted by a member without them (or after a demotion) is refused.
    if (required) {
      const lacking = SCOPE_PERMISSIONS[required].find((p) => !ctx.grants?.has(p));
      if (lacking) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          `The member this API key acts as no longer has access to this endpoint (needs "${required}").`,
          403,
        );
      }
    }
    ctx.ip = ip;

    await this.access.assertPlanFeatures(context, key.org_id);
    void this.access.touchLastUsed(key.org_id, key.id, LAST_USED_EVERY_SECONDS);

    return true;
  }

  /** Bearer token first, else `X-Api-Key` (WaDesk order). */
  private tokenOf(request: Request): string | undefined {
    const header = request.header('authorization');
    if (header && /^Bearer\s+/i.test(header)) {
      const token = header.replace(/^Bearer\s+/i, '').trim();
      if (token) return token;
    }
    const alt = request.header('x-api-key')?.trim();
    return alt || undefined;
  }

  /**
   * Privileged by necessity: the prefix has to resolve to an org before any tenant context can exist (one of the sanctioned uses, see
   * 0007_rls_policies.sql). Only bearer keys: a signed partner key's prefix never opens this surface.
   */
  private async lookup(prefix: string): Promise<BearerKeyRow | undefined> {
    const result = await this.db.privileged(async (tx) =>
      tx.execute(sql`
        SELECT k.org_id, k.id, k.key_hash, k.scopes, k.status::text AS status, k.expires_at,
               k.rate_limit_per_minute, k.user_id, u.id AS owner_id
        FROM api_keys k
        LEFT JOIN users u ON u.org_id = k.org_id AND u.id = k.user_id
        WHERE k.key_prefix = ${prefix} AND k.kind = 'bearer'
        LIMIT 1
      `),
    );
    return result.rows[0] as unknown as BearerKeyRow | undefined;
  }

  /** One counter per address that lives 60 seconds from its first failure, so a burst cannot straddle a clock minute and escape. */
  private failureKey(ip: string): string {
    return `apikey:authfail:${ip}`;
  }

  private async assertNotLockedOut(ip: string): Promise<void> {
    const failures = Number(await this.redis.get(this.failureKey(ip)).catch(() => 0));
    if (failures >= AUTH_FAILURES_PER_MINUTE) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many failed authentication attempts. Try again in a minute.',
        429,
      );
    }
  }

  private async recordFailure(ip: string): Promise<void> {
    const key = this.failureKey(ip);
    const n = await this.redis.incr(key).catch(() => 0);
    if (n === 1) await this.redis.expire(key, 60).catch(() => undefined);
  }
}
