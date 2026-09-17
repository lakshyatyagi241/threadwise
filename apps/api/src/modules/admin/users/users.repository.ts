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
