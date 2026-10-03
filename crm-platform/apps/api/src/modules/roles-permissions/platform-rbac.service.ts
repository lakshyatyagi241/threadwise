import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Tx } from '@crm/db';
import { PLATFORM_PERMISSION_KEYS, type PlatformMyPermissions } from '@crm/contracts';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { PlatformRbacStore } from './platform-rbac.store';

const CACHE_TTL_SECONDS = 600;
const VERSION_KEY = 'prbac:version';

/**
 * What a platform operator may do (WD-RBAC-003, 014, 019).
 *
 * An operator's permissions are the union of the permissions of every platform role assigned to them. The result is
 * cached under `prbac:v<version>:op<id>`; `rbac.version` (a platform_settings row) is bumped inside the transaction of every
 * role, permission or assignment change, so the next request after a commit reads fresh data (WaDesk flushed its cache the
 * same way). A cache failure never fails a request: the database already gave the authoritative answer.
 *
 * Enforcement is by permission, not by role name, so the roles screen can change what a role may do. A permission that no
 * longer exists simply is not in the set, so its check fails closed (WaDesk's rule 2 of WD-RBAC-003).
 */
@Injectable()
export class PlatformRbacService {
  private readonly logger = new Logger(PlatformRbacService.name);

  constructor(
    private readonly store: PlatformRbacStore,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async permissionsOf(operatorId: number): Promise<ReadonlySet<string>> {
    const version = await this.version();
    const key = `prbac:v${version}:op${operatorId}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) return new Set(JSON.parse(cached) as string[]);

    const names = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT DISTINCT p.name::text AS name
        FROM platform_operator_roles o
        JOIN platform_role_permissions rp ON rp.role_id = o.role_id
        JOIN platform_permissions p ON p.id = rp.permission_id
        WHERE o.operator_id = ${operatorId}
      `);
      return (res.rows as Array<{ name: string }>).map((r) => r.name);
    });
    await this.redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(names)).catch((err: unknown) => {
      this.logger.warn({ err }, 'failed to cache operator permissions');
    });
    return new Set(names);
  }

  async can(operatorId: number, permission: string): Promise<boolean> {
    return (await this.permissionsOf(operatorId)).has(permission);
  }

  /** The caller holds the locked Super Admin role: the tier above every permission (WD-RBAC-018). */
  async isSuperAdmin(operatorId: number): Promise<boolean> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT 1 FROM platform_operator_roles o JOIN platform_roles r ON r.id = o.role_id
        WHERE o.operator_id = ${operatorId} AND r.is_locked LIMIT 1
      `);
      return res.rows.length > 0;
    });
  }

  async myPermissions(operatorId: number): Promise<PlatformMyPermissions> {
    const held = await this.permissionsOf(operatorId);
    const [roles, superAdmin] = await Promise.all([
      this.store.tx(async (tx) => {
        const res = await tx.execute(sql`
          SELECT r.name::text AS name FROM platform_operator_roles o JOIN platform_roles r ON r.id = o.role_id
          WHERE o.operator_id = ${operatorId} ORDER BY r.id
        `);
        return (res.rows as Array<{ name: string }>).map((r) => r.name);
      }),
      this.isSuperAdmin(operatorId),
    ]);
    return {
      permissions: Object.fromEntries(PLATFORM_PERMISSION_KEYS.map((k) => [k, held.has(k)])),
      roles,
      isSuperAdmin: superAdmin,
    };
  }

  /** Call inside the transaction that changes roles, permissions or assignments. */
  async bumpInTx(tx: Tx): Promise<void> {
    await tx.execute(sql`
      INSERT INTO platform_settings (key, value) VALUES ('rbac.version', '2'::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = to_jsonb((platform_settings.value #>> '{}')::int + 1), updated_at = now()
    `);
  }

  /** Call after that transaction committed, so the next read does not see the old version from cache. */
  async dropVersionCache(): Promise<void> {
    await this.redis.del(VERSION_KEY).catch(() => undefined);
  }

  private async version(): Promise<number> {
    const cached = await this.redis.get(VERSION_KEY).catch(() => null);
    if (cached) return Number(cached);
    const version = await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT value #>> '{}' AS v FROM platform_settings WHERE key = 'rbac.version'`,
      );
      return Number((res.rows[0] as { v?: string } | undefined)?.v ?? 1);
    });
    await this.redis.setex(VERSION_KEY, CACHE_TTL_SECONDS, String(version)).catch(() => undefined);
    return version;
  }
}
