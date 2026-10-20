import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { RecordScope } from '@crm/contracts';
import { cacheMetrics } from '@crm/observability';
import { takeAuthPrefetch } from '../../common/context/auth-prefetch';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

export interface Grant {
  effect: 'allow' | 'deny';
  scope: RecordScope;
}

export type GrantSet = Map<string, Grant>;

/** The cached roles version and, when present, the serialized grant set stored under it. */
export type CachedRead = { version: number; grants: string | null };

const CACHE_TTL_SECONDS = 600;
const grantsCache = cacheMetrics('rbac_grants');
const versionCache = cacheMetrics('rbac_version');

/** Sets the cached roles version only if the key is empty or holds a lower one, so a slow reader cannot put an old version back. */
const RAISE_VERSION_LUA = `
local c = redis.call('GET', KEYS[1])
if (not c) or (tonumber(c) < tonumber(ARGV[1])) then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
end
return 1`;

/** KEYS[1] = rbac:version:<org>; ARGV = org id, user id. Returns {version, grants} with false for whatever is not cached. */
const READ_CACHED_LUA = `
local v = redis.call('GET', KEYS[1])
if not v then return {false, false} end
local g = redis.call('GET', 'rbac:' .. ARGV[1] .. ':v' .. v .. ':u' .. ARGV[2])
return {v, g}`;

/**
 * RBAC v3.
 *
 * Model:
 *   user -> roles -> grants(permission_key, effect, record_scope)
 *
 * Merge rules, in order:
 *   1. deny beats allow, always, regardless of which role it came from
 *   2. among allows, the widest scope wins (all > team > own)
 *
 * Rule 1 is what makes a "revoke" role actually revoke. Rule 2 is what makes
 * "Counsellor + Manager" behave the way a human expects.
 *
 * Enforcement is at the guard, not in RLS. RLS does tenant isolation only —
 * pushing per-user row filters into policies makes every query plan depend on
 * who is asking, which is how you get a fast endpoint for admins and a
 * sequential scan for everyone else.
 *
 * Cache key includes the org's roles_version, so a grant change invalidates
 * every cached set for that org at once — no key enumeration, no stale
 * permissions after an admin revokes access.
 */
@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async grantsForUser(orgId: number, userId: number): Promise<GrantSet> {
    // The usual case is a hit on both keys: one round trip for the version and the grant set together (see READ_CACHED_LUA).
    // JwtAuthGuard may already have started this read (auth-prefetch.ts); `readCached` never rejects, so the result is final.
    const early = await takeAuthPrefetch('grants', orgId, userId);
    const fast =
      early === undefined ? await this.readCached(orgId, userId) : (early as CachedRead | null);
    const version = fast ? fast.version : await this.rolesVersion(orgId);
    const cacheKey = `rbac:${orgId}:v${version}:u${userId}`;

    const cached = fast ? fast.grants : await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      grantsCache.hit();
      return new Map(Object.entries(JSON.parse(cached) as Record<string, Grant>));
    }
    grantsCache.miss();

    const grants = await this.loadGrants(orgId, userId);

    await this.redis
      .setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(Object.fromEntries(grants)))
      .catch((err: unknown) => {
        // A cache write failure must never fail the request — we already have
        // the authoritative answer from the database.
        this.logger.warn({ err }, 'failed to cache grant set');
      });

    return grants;
  }

  /**
   * Answers the guard's question. `scope` tells the service layer how far the
   * caller can see, which it then applies to the query.
   */
  can(grants: GrantSet, permissionKey: string): { allowed: boolean; scope: RecordScope } {
    const grant = grants.get(permissionKey);
    if (!grant || grant.effect === 'deny') {
      return { allowed: false, scope: 'own' };
    }
    return { allowed: true, scope: grant.scope };
  }

  /**
   * Called after any role/grant change, and only AFTER the change has committed: bumping inside the transaction lets a
   * concurrent request cache the old grants under the new version. Invalidation must not fail silently (AZ-012): the
   * cached version is deleted with a retry, then overwritten with the new version, and the error is surfaced only when
   * the cache can be neither cleared nor overwritten.
   */
  async bumpRolesVersion(orgId: number): Promise<void> {
    const version = await this.db.privileged(async (tx) => {
      const res = await tx.execute(
        sql`UPDATE organizations SET roles_version = roles_version + 1 WHERE id = ${orgId} RETURNING roles_version`,
      );
      return Number((res.rows[0] as { roles_version?: number } | undefined)?.roles_version ?? 0);
    });
    const key = `rbac:version:${orgId}`;
    let deleted = false;
    for (let attempt = 0; attempt < 3 && !deleted; attempt++) {
      try {
        await this.redis.del(key);
        deleted = true;
      } catch (err) {
        this.logger.warn({ err, orgId, attempt }, 'rbac version cache delete failed');
      }
    }
    // Put the new version in place and never move it backwards: a reader that loaded the old version before this bump
    // may still be about to write it.
    try {
      await this.redis.eval(RAISE_VERSION_LUA, 1, key, String(version), String(CACHE_TTL_SECONDS));
    } catch (err) {
      if (!deleted) {
        this.logger.error(
          { err, orgId, version },
          'rbac version cache could not be invalidated: removed grants may stay live',
        );
        throw new Error('Role change saved, but the permission cache could not be refreshed.');
      }
      this.logger.warn({ err, orgId }, 'rbac version cache could not be primed');
    }
  }

  /**
   * The cached roles version and, under it, the cached grant set: one script, one round trip, where two dependent reads
   * (version, then the key built from it) used to be two. Reads exactly the keys `rolesVersion` and `grantsForUser` use and
   * nothing else, so a version bump still invalidates every grant set at once.
   *
   * Returns null when the version is not cached or Redis fails; the caller then takes the original path (database for the
   * version, plain GET for the grants), so behaviour on a miss or an error is unchanged. The grant key is built inside the
   * script, so this needs a single Redis (or Sentinel) deployment, which is what REDIS_URL names; Redis Cluster would need
   * both keys on one hash slot.
   */
  /** Starts the cached read now, so a caller can send it together with its own Redis reads; `grantsForUser` then takes the result. */
  startCachedRead(orgId: number, userId: number): Promise<CachedRead | null> {
    return this.readCached(orgId, userId);
  }

  private async readCached(orgId: number, userId: number): Promise<CachedRead | null> {
    try {
      const res = (await this.redis.eval(
        READ_CACHED_LUA,
        1,
        `rbac:version:${orgId}`,
        String(orgId),
        String(userId),
      )) as [string | null, string | null] | null;
      const version = res?.[0] ? Number(res[0]) : NaN;
      if (!Number.isFinite(version)) {
        versionCache.miss();
        return null;
      }
      versionCache.hit();
      return { version, grants: res?.[1] ?? null };
    } catch (err) {
      versionCache.error();
      this.logger.warn({ err }, 'rbac cache read failed; reading the version separately');
      return null;
    }
  }

  private async rolesVersion(orgId: number): Promise<number> {
    const cacheKey = `rbac:version:${orgId}`;
    const cached = await this.redis.get(cacheKey).catch(() => {
      versionCache.error();
      return null;
    });
    if (cached) {
      versionCache.hit();
      return Number(cached);
    }
    versionCache.miss();

    const result = await this.db.privileged(async (tx) =>
      tx.execute(sql`SELECT roles_version FROM organizations WHERE id = ${orgId}`),
    );
    const version = Number((result.rows[0] as { roles_version?: number })?.roles_version ?? 1);
    await this.redis
      .eval(RAISE_VERSION_LUA, 1, cacheKey, String(version), String(CACHE_TTL_SECONDS))
      .catch(() => undefined);
    return version;
  }

  private async loadGrants(orgId: number, userId: number): Promise<GrantSet> {
    const result = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT rg.permission_key, rg.effect::text AS effect, rg.record_scope::text AS record_scope
        FROM role_grants rg
        JOIN user_roles ur
          ON ur.org_id = rg.org_id AND ur.role_id = rg.role_id
        WHERE rg.org_id = ${orgId}
          AND ur.user_id = ${userId}
      `),
    );

    const grants: GrantSet = new Map();
    const scopeRank: Record<RecordScope, number> = { own: 0, team: 1, all: 2 };

    for (const row of result.rows as Array<{
      permission_key: string;
      effect: 'allow' | 'deny';
      record_scope: RecordScope;
    }>) {
      const existing = grants.get(row.permission_key);

      // deny is absorbing: once denied, no later allow can lift it.
      if (existing?.effect === 'deny') continue;
      if (row.effect === 'deny') {
        grants.set(row.permission_key, { effect: 'deny', scope: row.record_scope });
        continue;
      }
      if (!existing || scopeRank[row.record_scope] > scopeRank[existing.scope]) {
        grants.set(row.permission_key, { effect: 'allow', scope: row.record_scope });
      }
    }

    return grants;
  }
}
