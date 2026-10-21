import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

const { users, userRoles, roles } = schema;

export interface UserRow {
  id: number;
  uuid: string;
  email: string;
  fullName: string;
  status: string;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRoleRow {
  userId: number;
  roleUuid: string;
  roleName: string;
}

export interface ListUsersFilter {
  limit: number;
  cursor?: string;
  order: 'asc' | 'desc';
  q?: string;
  status?: string;
  /** Team uuid: only people on it. */
  teamId?: string;
}

/** Every team of the workspace with its parent and its active manager: what `managersOf` walks up. */
export type TeamTree = Map<
  number,
  { parentId: number | null; lead: { userId: number; uuid: string; name: string } | null }
>;

export interface UserTeamRow {
  userId: number;
  teamId: number;
  teamUuid: string;
  teamName: string;
  teamColor: string;
  role: 'member' | 'lead';
  isPrimary: boolean;
}

/** Data access for staff users. Mirrors ContactsRepository's shape. */
@Injectable()
export class UsersRepository {
  private selection() {
    return {
      id: users.id,
      uuid: users.uuid,
      email: users.email,
      fullName: users.fullName,
      status: users.status,
      rowVersion: users.rowVersion,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    };
  }

  async list(tx: Tx, orgId: number, filter: ListUsersFilter): Promise<UserRow[]> {
    const conditions: SQL[] = [eq(users.orgId, orgId)];

    if (filter.status) {
      conditions.push(eq(users.status, filter.status));
    }
    if (filter.teamId) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM team_members tm JOIN teams t ON t.org_id = tm.org_id AND t.id = tm.team_id
        WHERE tm.org_id = ${orgId} AND tm.user_id = ${users.id} AND t.uuid = ${filter.teamId}::uuid)`);
    }
    if (filter.q) {
      const pattern = `%${filter.q}%`;
      const match = or(ilike(users.fullName, pattern), ilike(sql`${users.email}::text`, pattern));
      if (match) conditions.push(match);
    }
    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      conditions.push(
        filter.order === 'desc'
          ? or(
              lt(users.createdAt, cursor.createdAt),
              and(eq(users.createdAt, cursor.createdAt), lt(users.id, cursor.id)),
            )!
          : or(
              gt(users.createdAt, cursor.createdAt),
              and(eq(users.createdAt, cursor.createdAt), gt(users.id, cursor.id)),
            )!,
      );
    }

    const orderBy =
      filter.order === 'desc'
        ? [desc(users.createdAt), desc(users.id)]
        : [asc(users.createdAt), asc(users.id)];

    const rows = await tx
      .select(this.selection())
      .from(users)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(filter.limit + 1);

    return rows as UserRow[];
  }

  /** Teams of these users, plus the tree of every team with its active manager. Inactive people have no visible places (the tenant policy). */
  async teamsForUsers(
    tx: Tx,
    orgId: number,
    userIds: number[],
  ): Promise<{ rows: UserTeamRow[]; tree: TeamTree }> {
    const tree: TeamTree = new Map();
    if (userIds.length === 0) return { rows: [], tree };
    const teams = await tx.execute(sql`
      SELECT t.id, t.parent_team_id, lu.id AS lead_user_id, lu.uuid AS lead_uuid, lu.full_name AS lead_name
      FROM teams t
      LEFT JOIN users lu ON lu.org_id = t.org_id AND lu.id = t.lead_user_id AND lu.status <> 'inactive'
      WHERE t.org_id = ${orgId}`);
    for (const r of teams.rows as Array<Record<string, unknown>>) {
      tree.set(Number(r.id), {
        parentId:
          r.parent_team_id === null || r.parent_team_id === undefined
            ? null
            : Number(r.parent_team_id),
        lead: r.lead_uuid
          ? {
              userId: Number(r.lead_user_id),
              uuid: String(r.lead_uuid),
              name: String(r.lead_name),
            }
          : null,
      });
    }
    const res = await tx.execute(sql`
      SELECT tm.user_id, t.id AS team_id, t.uuid AS team_uuid, t.name AS team_name, t.color AS team_color, tm.role, tm.is_primary
      FROM team_members tm
      JOIN teams t ON t.org_id = tm.org_id AND t.id = tm.team_id
      WHERE tm.org_id = ${orgId} AND tm.user_id IN (${sql.join(
        userIds.map((i) => sql`${i}`),
        sql`, `,
      )})
      ORDER BY tm.is_primary DESC, t.sort, lower(t.name)`);
    const rows = (res.rows as Array<Record<string, unknown>>).map((r) => ({
      userId: Number(r.user_id),
      teamId: Number(r.team_id),
      teamUuid: String(r.team_uuid),
      teamName: String(r.team_name),
      teamColor: String(r.team_color),
      role: r.role === 'lead' ? ('lead' as const) : ('member' as const),
      isPrimary: Boolean(r.is_primary),
    }));
    return { rows, tree };
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<UserRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.uuid, uuid)));
    return rows[0] as UserRow | undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<UserRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.id, id)));
    return rows[0] as UserRow | undefined;
  }

  async findByEmail(tx: Tx, orgId: number, email: string): Promise<UserRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.email, email)));
    return rows[0] as UserRow | undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: { email: string; fullName: string; passwordHash: string },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(users)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        email: values.email,
        fullName: values.fullName,
        passwordHash: values.passwordHash,
      })
      .returning({ id: users.id, uuid: users.uuid });
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
      .update(users)
      .set(values)
      .where(and(eq(users.orgId, orgId), eq(users.id, id), eq(users.rowVersion, expectedVersion)))
      .returning({ id: users.id });
    return result.length > 0;
  }

  /** Roles for a batch of users, in one query — avoids N+1 on list(). */
  async rolesForUsers(tx: Tx, orgId: number, userIds: number[]): Promise<UserRoleRow[]> {
    if (userIds.length === 0) return [];
    const rows = await tx
      .select({ userId: userRoles.userId, roleUuid: roles.uuid, roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.orgId, userRoles.orgId), eq(roles.id, userRoles.roleId)))
      .where(and(eq(userRoles.orgId, orgId), inArray(userRoles.userId, userIds)));
    return rows;
  }

  /** A user's current roles with internal ids, for the grant rules and the audit delta. */
  async currentRoles(
    tx: Tx,
    orgId: number,
    userId: number,
  ): Promise<Array<{ id: number; name: string }>> {
    return tx
      .select({ id: roles.id, name: roles.name })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.orgId, userRoles.orgId), eq(roles.id, userRoles.roleId)))
      .where(and(eq(userRoles.orgId, orgId), eq(userRoles.userId, userId)));
  }

  async roleNames(tx: Tx, orgId: number, roleIds: number[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const rows = await tx
      .select({ name: roles.name })
      .from(roles)
      .where(and(eq(roles.orgId, orgId), inArray(roles.id, roleIds)));
    return rows.map((r) => r.name).sort();
  }

  /** Resolves role uuids to internal ids. Silently drops ones that don't exist in this org. */
  async resolveRoleIds(tx: Tx, orgId: number, uuids: string[]): Promise<number[]> {
    if (uuids.length === 0) return [];
    const rows = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.orgId, orgId), inArray(roles.uuid, uuids)));
    return rows.map((r) => r.id);
  }

  /** Full replacement of a user's role set. */
  async replaceRoles(tx: Tx, orgId: number, userId: number, roleIds: number[]): Promise<void> {
    await tx.delete(userRoles).where(and(eq(userRoles.orgId, orgId), eq(userRoles.userId, userId)));
    if (roleIds.length === 0) return;
    await tx.insert(userRoles).values(roleIds.map((roleId) => ({ orgId, userId, roleId })));
  }
}
