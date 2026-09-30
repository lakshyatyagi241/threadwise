import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { RecordScope } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

export interface Grant {
  effect: 'allow' | 'deny';
  scope: RecordScope;
}

export type GrantSet = Map<string, Grant>;

const CACHE_TTL_SECONDS = 600;

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
    const version = await this.rolesVersion(orgId);
    const cacheKey = `rbac:${orgId}:v${version}:u${userId}`;

    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      return new Map(Object.entries(JSON.parse(cached) as Record<string, Grant>));
    }

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

  /** Called after any role/grant change. Invalidates the whole org at once. */
  async bumpRolesVersion(orgId: number): Promise<void> {
    await this.db.privileged(async (tx) => {
      await tx.execute(
        sql`UPDATE organizations SET roles_version = roles_version + 1 WHERE id = ${orgId}`,
      );
    });
    await this.redis.del(`rbac:version:${orgId}`).catch(() => undefined);
  }

  private async rolesVersion(orgId: number): Promise<number> {
    const cacheKey = `rbac:version:${orgId}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return Number(cached);

    const result = await this.db.privileged(async (tx) =>
      tx.execute(sql`SELECT roles_version FROM organizations WHERE id = ${orgId}`),
    );
    const version = Number((result.rows[0] as { roles_version?: number })?.roles_version ?? 1);
    await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, String(version)).catch(() => undefined);
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
