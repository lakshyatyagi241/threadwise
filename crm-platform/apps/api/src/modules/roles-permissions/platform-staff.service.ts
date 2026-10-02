import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type PlatformStaff,
  type PlatformStaffListResponse,
  type SetStaffRolesInput,
} from '@crm/contracts';
import { HttpStatus } from '@nestjs/common';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { pgArray } from './pg-array';
import { PlatformRbacService } from './platform-rbac.service';
import { PlatformRbacStore } from './platform-rbac.store';
import { privilegedError } from './platform-roles.service';

interface StaffRow {
  id: number;
  uuid: string;
  email: string;
  full_name: string;
  role: 'super_admin' | 'support' | 'auditor';
  status: 'active' | 'suspended';
}

/**
 * Who holds which platform role (WD-RBAC-021). WaDesk documented this and never built it: its Users screen only edited a legacy
 * string. Granting or revoking the locked Super Admin role needs a Super Admin, and the last holder cannot be removed
 * (WD-RBAC-018: a stricter tier above the permission check).
 */
@Injectable()
export class PlatformStaffService {
  constructor(
    private readonly store: PlatformRbacStore,
    private readonly rbac: PlatformRbacService,
    private readonly audit: AuthAuditService,
  ) {}

  async list(): Promise<PlatformStaffListResponse> {
    return this.store.tx(async (tx) => {
      const ops = await tx.execute(
        sql`SELECT id, uuid, email::text AS email, full_name, role, status FROM platform_operators ORDER BY id`,
      );
      const held = await tx.execute(sql`
        SELECT o.operator_id, r.uuid, r.name::text AS name FROM platform_operator_roles o JOIN platform_roles r ON r.id = o.role_id ORDER BY r.id
      `);
      const roles = await tx.execute(
        sql`SELECT uuid, name::text AS name FROM platform_roles ORDER BY id`,
      );
      const byOperator = new Map<number, Array<{ id: string; name: string }>>();
      for (const h of held.rows as Array<{ operator_id: number; uuid: string; name: string }>) {
        byOperator.set(h.operator_id, [
          ...(byOperator.get(h.operator_id) ?? []),
          { id: h.uuid, name: h.name },
        ]);
      }
      return {
        data: (ops.rows as unknown as StaffRow[]).map((o): PlatformStaff => ({
          id: o.uuid,
          email: o.email,
          fullName: o.full_name,
          tier: o.role,
          status: o.status,
          roles: byOperator.get(o.id) ?? [],
        })),
        roles: (roles.rows as Array<{ uuid: string; name: string }>).map((r) => ({
          id: r.uuid,
          name: r.name,
        })),
      };
    });
  }

  /** Sets exactly these roles for the operator (a full replacement, like the permission sync on a role). */
  async setRoles(operatorUuid: string, input: SetStaffRolesInput): Promise<PlatformStaff> {
    const ctx = RequestContextStore.require();
    const wanted = [...new Set(input.roleIds)];
    const result = await this.store.tx(async (tx) => {
      const op = (
        await tx.execute(
          sql`SELECT id, uuid, email::text AS email, full_name, role, status FROM platform_operators WHERE uuid = ${operatorUuid}`,
        )
      ).rows[0] as unknown as StaffRow | undefined;
      if (!op) throw AppError.notFound('Operator', operatorUuid);

      const roleRows = (
        await tx.execute(
          sql`SELECT id, uuid, name::text AS name, is_locked FROM platform_roles WHERE uuid = ANY(${pgArray(wanted, 'uuid')})`,
        )
      ).rows as Array<{ id: number; uuid: string; name: string; is_locked: boolean }>;
      if (roleRows.length !== wanted.length) {
        throw AppError.validation('Some roles do not exist.', [
          { path: 'roleIds', message: 'Unknown role.' },
        ]);
      }
      const current = (
        await tx.execute(sql`
          SELECT r.id, r.name::text AS name, r.is_locked FROM platform_operator_roles o JOIN platform_roles r ON r.id = o.role_id WHERE o.operator_id = ${op.id}
        `)
      ).rows as Array<{ id: number; name: string; is_locked: boolean }>;

      const wantedIds = roleRows.map((r) => r.id);
      const gainsLocked = roleRows.some((r) => r.is_locked && !current.some((c) => c.id === r.id));
      const losesLocked = current.some((c) => c.is_locked && !wantedIds.includes(c.id));

      if ((gainsLocked || losesLocked) && !(await this.rbac.isSuperAdmin(ctx.actorId!))) {
        throw privilegedError();
      }
      if (losesLocked) {
        const others = (
          await tx.execute(sql`
            SELECT count(*) AS n FROM platform_operator_roles o JOIN platform_roles r ON r.id = o.role_id
            JOIN platform_operators p ON p.id = o.operator_id
            WHERE r.is_locked AND o.operator_id <> ${op.id} AND p.status = 'active'
          `)
        ).rows[0] as { n: string };
        if (Number(others.n) === 0) {
          throw new AppError(
            ERROR_CODES.RBAC_LAST_SUPER_ADMIN,
            'There must be at least one active Super Admin.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: 'roleIds', message: 'There must be at least one active Super Admin.' }],
          );
        }
      }

      await tx.execute(
        sql`DELETE FROM platform_operator_roles WHERE operator_id = ${op.id} AND NOT (role_id = ANY(${pgArray(wantedIds, 'bigint')}))`,
      );
      if (wantedIds.length > 0) {
        await tx.execute(sql`
          INSERT INTO platform_operator_roles (operator_id, role_id) SELECT ${op.id}, x FROM unnest(${pgArray(wantedIds, 'bigint')}) AS x ON CONFLICT DO NOTHING
        `);
      }
      await this.rbac.bumpInTx(tx);
      await this.audit.record(tx, {
        event: 'admin.staff.roles_changed',
        status: gainsLocked || losesLocked ? 'warning' : 'info',
        recordId: op.id,
        payload: {
          operator: op.email,
          from: current.map((c) => c.name).sort(),
          to: roleRows.map((r) => r.name).sort(),
        },
      });
      return op.uuid;
    });
    await this.rbac.dropVersionCache();
    const all = await this.list();
    return all.data.find((s) => s.id === result)!;
  }
}
