import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  permissionNameSchema,
  type CreatePlatformPermissionInput,
  type PlatformPermission,
  type PlatformPermissionListResponse,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { PlatformRbacService } from './platform-rbac.service';
import { PlatformRbacStore } from './platform-rbac.store';

interface PermissionRow {
  uuid: string;
  name: string;
  is_system: boolean;
  created_at: Date | string;
  role_count: number | string;
}

/** Grouping rule of the catalogue: the text before the first dot; a name without a dot is its own module. */
export const moduleOf = (name: string): string => {
  const dot = name.indexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
};

const toPermission = (r: PermissionRow): PlatformPermission => ({
  id: r.uuid,
  name: r.name,
  module: moduleOf(r.name),
  isSystem: r.is_system,
  roleCount: Number(r.role_count),
  createdAt: new Date(r.created_at).toISOString(),
});

/** The permission catalogue (TW-RBAC-011..013). */
@Injectable()
export class PlatformPermissionsService {
  constructor(
    private readonly store: PlatformRbacStore,
    private readonly rbac: PlatformRbacService,
    private readonly audit: AuthAuditService,
  ) {}

  async list(): Promise<PlatformPermissionListResponse> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT p.uuid, p.name::text AS name, p.is_system, p.created_at,
          (SELECT count(*) FROM platform_role_permissions rp WHERE rp.permission_id = p.id) AS role_count
        FROM platform_permissions p ORDER BY p.name
      `);
      const data = (res.rows as unknown as PermissionRow[]).map(toPermission);
      const used = data.filter((p) => p.roleCount > 0).length;
      const newest = (res.rows as unknown as PermissionRow[]).reduce<PermissionRow | null>(
        (best, r) => (!best || new Date(r.created_at) > new Date(best.created_at) ? r : best),
        null,
      );
      return {
        data,
        kpis: {
          total: data.length,
          modules: new Set(data.map((p) => p.module)).size,
          usedInRoles: used,
          orphans: data.length - used,
          lastAdded: newest
            ? { name: newest.name, at: new Date(newest.created_at).toISOString() }
            : null,
        },
      };
    });
  }

  /**
   * A name with no dot plus a module and an action becomes `<module>.<action>`. Format and uniqueness are checked on the
   * final name (Reference checked the raw field and then failed with a 500 when the composed name already existed).
   */
  async create(input: CreatePlatformPermissionInput): Promise<PlatformPermission> {
    const composed =
      !input.name.includes('.') && input.module && input.action
        ? `${input.module}.${input.action}`
        : input.name;
    const parsed = permissionNameSchema.safeParse(composed);
    if (!parsed.success) {
      throw AppError.validation('The permission name is not valid.', [
        { path: 'name', message: parsed.error.issues[0]?.message ?? 'Invalid name.' },
      ]);
    }
    const name = parsed.data;

    const result = await this.store.tx(async (tx) => {
      let row: PermissionRow;
      try {
        const res = await tx.execute(sql`
          INSERT INTO platform_permissions (name) VALUES (${name}) RETURNING uuid, name::text AS name, is_system, created_at, 0 AS role_count
        `);
        row = res.rows[0] as unknown as PermissionRow;
      } catch (err) {
        if (
          (err as { code?: string }).code === '23505' ||
          (err as { cause?: { code?: string } }).cause?.code === '23505'
        ) {
          throw new AppError(
            ERROR_CODES.RBAC_PERMISSION_NAME_TAKEN,
            `A permission named "${name}" already exists.`,
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: 'name', message: 'The name has already been taken.' }],
          );
        }
        throw err;
      }
      await this.rbac.bumpInTx(tx);
      await this.audit.record(tx, {
        event: 'admin.permission.created',
        status: 'info',
        payload: { permission: name },
      });
      return toPermission(row);
    });
    await this.rbac.dropVersionCache();
    return result;
  }

  /**
   * Every role that held it loses it at once. The 16 keys the code checks cannot go: deleting one would fail its check closed
   * for every operator, Super Admin included (Reference allowed it).
   */
  async remove(uuid: string): Promise<{ name: string }> {
    const result = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, name::text AS name, is_system,
          (SELECT count(*) FROM platform_role_permissions rp WHERE rp.permission_id = p.id) AS role_count
        FROM platform_permissions p WHERE uuid = ${uuid}
      `);
      const row = res.rows[0] as unknown as
        { id: number; name: string; is_system: boolean; role_count: string } | undefined;
      if (!row) throw AppError.notFound('Permission', uuid);
      if (row.is_system) {
        throw new AppError(
          ERROR_CODES.RBAC_PERMISSION_SYSTEM,
          `${row.name} is checked by the platform and cannot be deleted.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          [
            {
              path: 'permission',
              message: `${row.name} is checked by the platform and cannot be deleted.`,
            },
          ],
        );
      }
      await tx.execute(sql`DELETE FROM platform_permissions WHERE id = ${row.id}`);
      await this.rbac.bumpInTx(tx);
      await this.audit.record(tx, {
        event: 'admin.permission.deleted',
        status: 'warning',
        payload: { permission: row.name, roles: Number(row.role_count) },
      });
      return { name: row.name };
    });
    await this.rbac.dropVersionCache();
    return result;
  }
}
