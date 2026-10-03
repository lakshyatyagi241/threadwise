import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

const { roles, roleGrants } = schema;

export interface RoleRow {
  id: number;
  uuid: string;
  name: string;
  systemKey: string | null;
  isLocked: boolean;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleGrantRow {
  roleId: number;
  permissionKey: string;
  effect: 'allow' | 'deny';
  recordScope: 'all' | 'team' | 'own';
}

export interface ListRolesFilter {
  limit: number;
  cursor?: string;
  order: 'asc' | 'desc';
}

/** Data access for roles and their grants. */
@Injectable()
export class RolesRepository {
  private selection() {
    return {
      id: roles.id,
      uuid: roles.uuid,
      name: roles.name,
      systemKey: roles.systemKey,
      isLocked: roles.isLocked,
      rowVersion: roles.rowVersion,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
    };
  }

  async list(tx: Tx, orgId: number, filter: ListRolesFilter): Promise<RoleRow[]> {
    const conditions: SQL[] = [eq(roles.orgId, orgId)];

    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      conditions.push(
        filter.order === 'desc'
          ? or(
              lt(roles.createdAt, cursor.createdAt),
              and(eq(roles.createdAt, cursor.createdAt), lt(roles.id, cursor.id)),
            )!
          : or(
              gt(roles.createdAt, cursor.createdAt),
              and(eq(roles.createdAt, cursor.createdAt), gt(roles.id, cursor.id)),
            )!,
      );
    }

    const orderBy =
      filter.order === 'desc'
        ? [desc(roles.createdAt), desc(roles.id)]
        : [asc(roles.createdAt), asc(roles.id)];

    const rows = await tx
      .select(this.selection())
      .from(roles)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(filter.limit + 1);

    return rows as RoleRow[];
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<RoleRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.uuid, uuid)));
    return rows[0] as RoleRow | undefined;
  }

  async findByName(tx: Tx, orgId: number, name: string): Promise<RoleRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.name, name)));
    return rows[0] as RoleRow | undefined;
  }

  async grantsForRoles(tx: Tx, orgId: number, roleIds: number[]): Promise<RoleGrantRow[]> {
    if (roleIds.length === 0) return [];
    const rows = await tx
      .select({
        roleId: roleGrants.roleId,
        permissionKey: roleGrants.permissionKey,
        effect: roleGrants.effect,
        recordScope: roleGrants.recordScope,
      })
      .from(roleGrants)
      .where(and(eq(roleGrants.orgId, orgId), inArray(roleGrants.roleId, roleIds)));
    return rows as RoleGrantRow[];
  }

  /** Members per role, for the roles screen and the delete guard. */
  async userCounts(tx: Tx, orgId: number, roleIds: number[]): Promise<Map<number, number>> {
    if (roleIds.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT role_id, count(*)::int AS n FROM user_roles
      WHERE org_id = ${orgId} AND role_id IN (${sql.join(
        roleIds.map((i) => sql`${i}`),
        sql`, `,
      )})
      GROUP BY role_id
    `);
    return new Map(
      (res.rows as Array<{ role_id: number; n: number }>).map((r) => [
        Number(r.role_id),
        Number(r.n),
      ]),
    );
  }

  async insert(tx: Tx, orgId: number, name: string): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(roles)
      .values({ orgId, uuid: sql`gen_random_uuid()`, name })
      .returning({ id: roles.id, uuid: roles.uuid });
    return row!;
  }

  async updateWithVersion(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    values: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await tx
      .update(roles)
      .set(values)
      .where(and(eq(roles.orgId, orgId), eq(roles.id, id), eq(roles.rowVersion, expectedVersion)))
      .returning({ id: roles.id });
    return result.length > 0;
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.id, id)))
      .returning({ id: roles.id });
    return result.length > 0;
  }

  /** Full replacement of a role's grant set. */
  async replaceGrants(
    tx: Tx,
    orgId: number,
    roleId: number,
    grants: Array<{
      permissionKey: string;
      effect: 'allow' | 'deny';
      recordScope: 'all' | 'team' | 'own';
    }>,
  ): Promise<void> {
    await tx
      .delete(roleGrants)
      .where(and(eq(roleGrants.orgId, orgId), eq(roleGrants.roleId, roleId)));
    if (grants.length === 0) return;
    await tx.insert(roleGrants).values(
      grants.map((g) => ({
        orgId,
        roleId,
        permissionKey: g.permissionKey,
        effect: g.effect,
        recordScope: g.recordScope,
      })),
    );
  }
}
