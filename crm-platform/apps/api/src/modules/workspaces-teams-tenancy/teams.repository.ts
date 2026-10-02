import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../common/pagination/cursor';
import { toDate } from './members.repository';

type Raw = Record<string, unknown>;

export interface TeamRow {
  id: number;
  uuid: string;
  name: string;
  slug: string | null;
  color: string;
  description: string | null;
  assignmentStrategy: string;
  isDefault: boolean;
  sort: number;
  /** Device uuids the team handles; empty = every device. */
  deviceIds: string[];
  rowVersion: number;
  createdAt: Date;
  /** The same instant at the database's microsecond precision, for the cursor. */
  createdAtIso: string;
}

export interface TeamMemberRow {
  teamId: number;
  userUuid: string;
  fullName: string;
  presence: string | null;
  isLead: boolean;
  capacity: number;
}

export interface TeamListFilter {
  limit: number;
  cursor?: string;
  order: 'asc' | 'desc';
  q?: string;
}

const COLUMNS = sql`t.id, t.uuid, t.name, t.slug, t.color, t.description, t.assignment_strategy, t.is_default, t.sort,
  t.device_ids, t.row_version, t.created_at,
  to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso`;

const toTeam = (r: Raw): TeamRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  name: String(r.name),
  slug: (r.slug as string | null) ?? null,
  color: String(r.color),
  description: (r.description as string | null) ?? null,
  assignmentStrategy: String(r.assignment_strategy),
  isDefault: Boolean(r.is_default),
  sort: Number(r.sort),
  deviceIds: Array.isArray(r.device_ids) ? (r.device_ids as string[]) : [],
  rowVersion: Number(r.row_version),
  createdAt: toDate(r.created_at)!,
  createdAtIso: String(r.created_at_iso),
});

const idList = (ids: number[]): SQL =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );

/** Data access for teams and their members. Every method runs inside the tenant transaction it is handed. */
@Injectable()
export class TeamsRepository {
  async list(tx: Tx, orgId: number, f: TeamListFilter): Promise<TeamRow[]> {
    const conds: SQL[] = [sql`t.org_id = ${orgId}`];
    if (f.q) {
      conds.push(sql`t.name ILIKE ${`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
    }
    if (f.cursor) {
      const c = decodeCursor(f.cursor);
      const at = c.createdAtIso ?? c.createdAt.toISOString();
      conds.push(
        f.order === 'desc'
          ? sql`(t.created_at, t.id) < (${at}::timestamptz, ${c.id})`
          : sql`(t.created_at, t.id) > (${at}::timestamptz, ${c.id})`,
      );
    }
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM teams t WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY ${f.order === 'desc' ? sql`t.created_at DESC, t.id DESC` : sql`t.created_at ASC, t.id ASC`}
      LIMIT ${f.limit + 1}`);
    return (res.rows as Raw[]).map(toTeam);
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<TeamRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM teams t WHERE t.org_id = ${orgId} AND t.uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as Raw | undefined;
    return row ? toTeam(row) : undefined;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<TeamRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM teams t WHERE t.org_id = ${orgId} AND t.id = ${id}`,
    );
    const row = res.rows[0] as Raw | undefined;
    return row ? toTeam(row) : undefined;
  }

  async nameTaken(tx: Tx, orgId: number, name: string, exceptId?: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM teams WHERE org_id = ${orgId} AND name = ${name} ${exceptId ? sql`AND id <> ${exceptId}` : sql``}`);
    return res.rows.length > 0;
  }

  async slugTaken(tx: Tx, orgId: number, slug: string): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM teams WHERE org_id = ${orgId} AND slug = ${slug}`,
    );
    return res.rows.length > 0;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      name: string;
      slug: string;
      color: string;
      description: string | null;
      assignmentStrategy: string;
      deviceIds: string[];
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO teams (org_id, name, slug, color, description, assignment_strategy, device_ids)
      VALUES (${orgId}, ${v.name}, ${v.slug}, ${v.color}, ${v.description}, ${v.assignmentStrategy},
              ${v.deviceIds.length > 0 ? JSON.stringify(v.deviceIds) : null}::jsonb)
      RETURNING id`);
    return Number((res.rows[0] as Raw).id);
  }

  /** Applies the changed fields when the row version still matches; false means somebody changed the team first. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expected: number,
    v: Partial<{
      name: string;
      color: string;
      description: string | null;
      assignmentStrategy: string;
      deviceIds: string[];
    }>,
  ): Promise<boolean> {
    const sets: SQL[] = [sql`updated_at = now()`];
    if (v.name !== undefined) sets.push(sql`name = ${v.name}`);
    if (v.color !== undefined) sets.push(sql`color = ${v.color}`);
    if (v.description !== undefined) sets.push(sql`description = ${v.description}`);
    if (v.assignmentStrategy !== undefined)
      sets.push(sql`assignment_strategy = ${v.assignmentStrategy}`);
    if (v.deviceIds !== undefined) {
      sets.push(
        sql`device_ids = ${v.deviceIds.length > 0 ? JSON.stringify(v.deviceIds) : null}::jsonb`,
      );
    }
    const res = await tx.execute(sql`
      UPDATE teams SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expected} RETURNING id`);
    return res.rows.length > 0;
  }

  /** Members go with the team (cascade); conversations assigned to it lose the team (ON DELETE SET NULL). */
  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM teams WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Active (not removed) users of the organization for these uuids, as uuid to id. */
  async activeUserIds(tx: Tx, orgId: number, uuids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (uuids.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT uuid, id FROM users
      WHERE org_id = ${orgId} AND status <> 'inactive'
        AND uuid IN (${sql.join(
          uuids.map((u) => sql`${u}::uuid`),
          sql`, `,
        )})`);
    for (const r of res.rows as Raw[]) out.set(String(r.uuid), Number(r.id));
    return out;
  }

  /** The device uuids that really exist in this organization; the rest are dropped without an error. */
  async existingDeviceUuids(tx: Tx, orgId: number, uuids: string[]): Promise<Set<string>> {
    if (uuids.length === 0) return new Set();
    const res = await tx.execute(sql`
      SELECT uuid FROM devices
      WHERE org_id = ${orgId} AND uuid IN (${sql.join(
        uuids.map((u) => sql`${u}::uuid`),
        sql`, `,
      )})`);
    return new Set((res.rows as Raw[]).map((r) => String(r.uuid)));
  }

  async members(tx: Tx, orgId: number, teamIds: number[]): Promise<TeamMemberRow[]> {
    if (teamIds.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT tm.team_id, u.uuid AS user_uuid, u.full_name, tm.is_lead, tm.capacity, a.status AS presence_status
      FROM team_members tm
      JOIN users u ON u.org_id = tm.org_id AND u.id = tm.user_id AND u.status <> 'inactive'
      LEFT JOIN agent_statuses a ON a.org_id = u.org_id AND a.user_id = u.id
      WHERE tm.org_id = ${orgId} AND tm.team_id IN (${idList(teamIds)})
      ORDER BY lower(u.full_name), u.id`);
    return (res.rows as Raw[]).map((r) => ({
      teamId: Number(r.team_id),
      userUuid: String(r.user_uuid),
      fullName: String(r.full_name),
      presence: (r.presence_status as string | null) ?? null,
      isLead: Boolean(r.is_lead),
      capacity: Number(r.capacity),
    }));
  }

  /** `sync()`: members not in the list leave, new ones join with the defaults, kept ones keep their lead flag and capacity. */
  async syncMembers(tx: Tx, orgId: number, teamId: number, userIds: number[]): Promise<void> {
    if (userIds.length === 0) {
      await tx.execute(
        sql`DELETE FROM team_members WHERE org_id = ${orgId} AND team_id = ${teamId}`,
      );
      return;
    }
    await tx.execute(sql`
      DELETE FROM team_members
      WHERE org_id = ${orgId} AND team_id = ${teamId} AND user_id NOT IN (${idList(userIds)})`);
    await tx.execute(sql`
      INSERT INTO team_members (org_id, team_id, user_id)
      SELECT ${orgId}, ${teamId}, u FROM unnest(ARRAY[${idList(userIds)}]::bigint[]) AS u
      ON CONFLICT (org_id, team_id, user_id) DO NOTHING`);
  }
}
