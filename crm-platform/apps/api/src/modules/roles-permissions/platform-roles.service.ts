import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  ERROR_CODES,
  type CreatePlatformRoleInput,
  type PlatformRoleDetail,
  type PlatformRoleListQuery,
  type PlatformRoleListResponse,
  type PlatformRoleSummary,
  type ReassignRoleInput,
  type ReassignRoleResponse,
  type UpdatePlatformRoleInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { pgArray } from './pg-array';
import { PlatformRbacService } from './platform-rbac.service';
import { PlatformRbacStore } from './platform-rbac.store';

interface RoleRow {
  id: number;
  uuid: string;
  name: string;
  description: string;
  is_locked: boolean;
  is_system: boolean;
  row_version: number;
  updated_at: Date | string;
  user_count: number | string;
  permission_count: number | string;
}

const iso = (d: Date | string) => new Date(d).toISOString();

const toSummary = (r: RoleRow): PlatformRoleSummary => ({
  id: r.uuid,
  name: r.name,
  description: r.description,
  isLocked: r.is_locked,
  isSystem: r.is_system,
  userCount: Number(r.user_count),
  permissionCount: Number(r.permission_count),
  updatedAt: iso(r.updated_at),
});

const SELECT_ROLE = sql`
  SELECT r.id, r.uuid, r.name::text AS name, r.description, r.is_locked, r.is_system, r.row_version, r.updated_at,
    (SELECT count(*) FROM platform_operator_roles o WHERE o.role_id = r.id) AS user_count,
    (SELECT count(*) FROM platform_role_permissions p WHERE p.role_id = r.id) AS permission_count
  FROM platform_roles r
`;

/** `%` and `_` in a search term are text, not wildcards. */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Platform roles (TW-RBAC-005..010). The permission cache version is bumped in the same transaction as every change. */
@Injectable()
export class PlatformRolesService {
  constructor(
    private readonly store: PlatformRbacStore,
    private readonly rbac: PlatformRbacService,
    private readonly audit: AuthAuditService,
  ) {}

  async list(query: PlatformRoleListQuery): Promise<PlatformRoleListResponse> {
    return this.store.tx(async (tx) => {
      const filters = [sql`true`];
      if (query.type === 'system') filters.push(sql`r.is_system`);
      if (query.type === 'custom') filters.push(sql`NOT r.is_system`);
      if (query.search) filters.push(sql`r.name::text ILIKE ${likePattern(query.search)}`);
      const rows = await tx.execute(
        sql`${SELECT_ROLE} WHERE ${sql.join(filters, sql` AND `)} ORDER BY r.id`,
      );
      const totals = await tx.execute(sql`
        SELECT (SELECT count(*) FROM platform_roles) AS total_roles,
               (SELECT count(*) FROM platform_roles WHERE is_system) AS system_roles,
               (SELECT count(*) FROM platform_permissions) AS total_permissions,
               (SELECT count(*) FROM platform_operator_roles) AS users_with_role,
               (SELECT count(*) FROM platform_roles r WHERE NOT EXISTS
                  (SELECT 1 FROM platform_operator_roles o WHERE o.role_id = r.id)) AS roles_without_users
      `);
      const t = totals.rows[0] as Record<string, string | number>;
      return {
        data: (rows.rows as unknown as RoleRow[]).map(toSummary),
        kpis: {
          totalRoles: Number(t.total_roles),
          systemRoles: Number(t.system_roles),
          customRoles: Number(t.total_roles) - Number(t.system_roles),
          totalPermissions: Number(t.total_permissions),
          usersWithRole: Number(t.users_with_role),
          rolesWithoutUsers: Number(t.roles_without_users),
        },
      };
    });
  }

  async get(uuid: string): Promise<PlatformRoleDetail> {
    return this.store.tx((tx) => this.detail(tx, uuid));
  }

  async create(input: CreatePlatformRoleInput): Promise<PlatformRoleDetail> {
    const result = await this.store.tx(async (tx) => {
      const permissionIds = await this.resolvePermissions(tx, input.permissions);
      const created = await this.insertRole(tx, input.name, input.description, false);
      await this.setPermissions(tx, created.id, permissionIds);
      await this.rbac.bumpInTx(tx);
      await this.audit.record(tx, {
        event: 'admin.role.created',
        status: 'info',
        payload: { role: input.name, permissions: [...new Set(input.permissions)].sort() },
      });
      return this.detail(tx, created.uuid);
    });
    await this.rbac.dropVersionCache();
    return result;
  }

  async update(uuid: string, input: UpdatePlatformRoleInput): Promise<PlatformRoleDetail> {
    const result = await this.store.tx(async (tx) => {
      const role = await this.findRole(tx, uuid);
      const permissionIds = await this.resolvePermissions(tx, input.permissions);
      const before = await this.permissionNames(tx, role.id);
      const after = [...new Set(input.permissions)].sort();

      if (role.is_locked) {
        const stripped = before.filter((n) => !after.includes(n));
        if (input.name.toLowerCase() !== role.name.toLowerCase() || stripped.length > 0) {
          throw lockedError(role.name, 'cannot be renamed or stripped of permissions');
        }
      }

      try {
        const res = await tx.execute(sql`
          UPDATE platform_roles SET name = ${input.name}, description = ${input.description}
          WHERE id = ${role.id} AND row_version = ${input.rowVersion}
        `);
        if (res.rowCount === 0) throw AppError.rowVersionConflict('Role');
      } catch (err) {
        throw mapNameTaken(err, input.name);
      }
      await this.setPermissions(tx, role.id, permissionIds);
      await this.rbac.bumpInTx(tx);
      await this.audit.record(tx, {
        event: 'admin.role.updated',
        status: 'info',
        payload: {
          role: input.name,
          renamedFrom: input.name === role.name ? undefined : role.name,
          added: after.filter((n) => !before.includes(n)),
          removed: before.filter((n) => !after.includes(n)),
        },
      });
      return this.detail(tx, uuid);
    });
    await this.rbac.dropVersionCache();
    return result;
  }

  /** Clone of a role: name, description and permission set, never its operators and never the lock. */
  async duplicate(uuid: string): Promise<PlatformRoleDetail> {
    const result = await this.store.tx(async (tx) => {
      const role = await this.findRole(tx, uuid);
      const name = await this.freeCopyName(tx, role.name);
      const copy = await this.insertRole(tx, name, role.description, false);
      await tx.execute(sql`
        INSERT INTO platform_role_permissions (role_id, permission_id)
        SELECT ${copy.id}, permission_id FROM platform_role_permissions WHERE role_id = ${role.id}
      `);
      await this.rbac.bumpInTx(tx);
      await this.audit.record(tx, {
        event: 'admin.role.duplicated',
        status: 'info',
        payload: { from: role.name, to: name },
      });
      return this.detail(tx, copy.uuid);
    });
    await this.rbac.dropVersionCache();
    return result;
  }

  /** Moves every operator holding `from` onto the target role, in one transaction (Reference ran it unguarded, step by step). */
  async reassign(uuid: string, input: ReassignRoleInput): Promise<ReassignRoleResponse> {
    const ctx = RequestContextStore.require();
    const result = await this.store.tx(async (tx) => {
      const from = await this.findRole(tx, uuid);
      const to = await this.findRole(tx, input.targetRoleId);
      if (from.id === to.id) {
        throw new AppError(
          ERROR_CODES.RBAC_REASSIGN_SAME_ROLE,
          'Pick a different role to move users into.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'targetRoleId', message: 'Pick a different role to move users into.' }],
        );
      }
      // Moving everybody off Super Admin always leaves it empty; moving people onto it is a privileged grant.
      if (from.is_locked) throw lockedError(from.name, 'cannot have its users reassigned');
      if (to.is_locked && !(await this.rbac.isSuperAdmin(ctx.actorId!))) throw privilegedError();

      const moved = await tx.execute(sql`
        DELETE FROM platform_operator_roles WHERE role_id = ${from.id} RETURNING operator_id
      `);
      const operatorIds = (moved.rows as Array<{ operator_id: number }>).map((r) => r.operator_id);
      if (operatorIds.length > 0) {
        await tx.execute(sql`
          INSERT INTO platform_operator_roles (operator_id, role_id)
          SELECT x, ${to.id} FROM unnest(${pgArray(operatorIds, 'bigint')}) AS x ON CONFLICT DO NOTHING
        `);
      }
      await this.rbac.bumpInTx(tx);
      await this.audit.record(tx, {
        event: 'admin.role.reassigned',
        status: 'warning',
        payload: { from: from.name, to: to.name, users: operatorIds.length },
      });
      return { moved: operatorIds.length, from: from.name, to: to.name };
    });
    await this.rbac.dropVersionCache();
    return result;
  }

  /** Users keep their other roles and simply lose this one; the Super Admin role cannot be deleted. */
  async remove(uuid: string): Promise<{ name: string }> {
    const result = await this.store.tx(async (tx) => {
      const role = await this.findRole(tx, uuid);
      if (role.is_locked) throw lockedError(role.name, 'is system-locked and cannot be deleted');
      await tx.execute(sql`DELETE FROM platform_roles WHERE id = ${role.id}`);
      await this.rbac.bumpInTx(tx);
      await this.audit.record(tx, {
        event: 'admin.role.deleted',
        status: 'warning',
        payload: { role: role.name, users: Number(role.user_count) },
      });
      return { name: role.name };
    });
    await this.rbac.dropVersionCache();
    return result;
  }

  // --- helpers ----------------------------------------------------------------------------------------------------

  private async findRole(tx: Tx, uuid: string): Promise<RoleRow> {
    const res = await tx.execute(sql`${SELECT_ROLE} WHERE r.uuid = ${uuid}`);
    const row = res.rows[0] as unknown as RoleRow | undefined;
    if (!row) throw AppError.notFound('Role', uuid);
    return row;
  }

  private async permissionNames(tx: Tx, roleId: number): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT p.name::text AS name FROM platform_role_permissions rp JOIN platform_permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ${roleId} ORDER BY p.name
    `);
    return (res.rows as Array<{ name: string }>).map((r) => r.name);
  }

  private async detail(tx: Tx, uuid: string): Promise<PlatformRoleDetail> {
    const role = await this.findRole(tx, uuid);
    const others = await tx.execute(
      sql`SELECT uuid, name::text AS name FROM platform_roles WHERE id <> ${role.id} ORDER BY name`,
    );
    return {
      ...toSummary(role),
      permissions: await this.permissionNames(tx, role.id),
      rowVersion: role.row_version,
      otherRoles: (others.rows as Array<{ uuid: string; name: string }>).map((o) => ({
        id: o.uuid,
        name: o.name,
      })),
    };
  }

  /** Names to ids. An unknown name is refused (Reference dropped it silently, which hid typos). */
  private async resolvePermissions(tx: Tx, names: string[]): Promise<number[]> {
    const unique = [...new Set(names)];
    if (unique.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT id, name::text AS name FROM platform_permissions WHERE name::text = ANY(${pgArray(unique, 'text')})
    `);
    const found = new Map(
      (res.rows as Array<{ id: number; name: string }>).map((r) => [r.name, r.id]),
    );
    const unknown = unique.filter((n) => !found.has(n));
    if (unknown.length > 0) {
      throw new AppError(
        ERROR_CODES.RBAC_PERMISSION_UNKNOWN,
        'Some permissions are not in the catalogue.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        unknown.map((n) => ({ path: 'permissions', message: n })),
      );
    }
    return [...found.values()];
  }

  /** Full replacement: exactly the ticked boxes. */
  private async setPermissions(tx: Tx, roleId: number, permissionIds: number[]): Promise<void> {
    await tx.execute(sql`
      DELETE FROM platform_role_permissions WHERE role_id = ${roleId} AND NOT (permission_id = ANY(${pgArray(permissionIds, 'bigint')}))
    `);
    if (permissionIds.length > 0) {
      await tx.execute(sql`
        INSERT INTO platform_role_permissions (role_id, permission_id)
        SELECT ${roleId}, x FROM unnest(${pgArray(permissionIds, 'bigint')}) AS x ON CONFLICT DO NOTHING
      `);
    }
  }

  private async insertRole(
    tx: Tx,
    name: string,
    description: string,
    isSystem: boolean,
  ): Promise<{ id: number; uuid: string }> {
    try {
      const res = await tx.execute(sql`
        INSERT INTO platform_roles (name, description, is_system) VALUES (${name}, ${description}, ${isSystem})
        RETURNING id, uuid
      `);
      return res.rows[0] as unknown as { id: number; uuid: string };
    } catch (err) {
      throw mapNameTaken(err, name);
    }
  }

  /** `<name> (copy)`, then `(copy 2)`, `(copy 3)` ... until free. */
  private async freeCopyName(tx: Tx, base: string): Promise<string> {
    const res = await tx.execute(
      sql`SELECT name::text AS name FROM platform_roles WHERE name::text ILIKE ${likePattern(base)}`,
    );
    const taken = new Set((res.rows as Array<{ name: string }>).map((r) => r.name.toLowerCase()));
    let candidate = `${base} (copy)`;
    for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${base} (copy ${n})`;
    return candidate;
  }
}

const lockedError = (name: string, what: string) =>
  new AppError(
    ERROR_CODES.RBAC_ROLE_LOCKED,
    `${name} role ${what}.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path: 'role', message: `${name} role ${what}.` }],
  );

export const privilegedError = () =>
  new AppError(
    ERROR_CODES.RBAC_PRIVILEGED_ROLE,
    'Granting or revoking the Super Admin role requires a Super Admin.',
    HttpStatus.FORBIDDEN,
  );

function mapNameTaken(err: unknown, name: string): unknown {
  if (
    (err as { code?: string; cause?: { code?: string } }).code === '23505' ||
    (err as { cause?: { code?: string } }).cause?.code === '23505'
  ) {
    return new AppError(
      ERROR_CODES.RBAC_ROLE_NAME_TAKEN,
      `A role named "${name}" already exists.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'name', message: 'The name has already been taken.' }],
    );
  }
  return err;
}
