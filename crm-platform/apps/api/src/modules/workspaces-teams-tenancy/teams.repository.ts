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
  /** Device uuids the team handles; empty = every device. Stored, not read by routing yet. */
  deviceIds: string[];
  parentId: number | null;
  parentUuid: string | null;
  /** 1 for a top-level team. */
  depth: number;
  /** Set only while the manager is an active member; the choice itself (`lead_user_id`) survives a deactivation. */
  leadUserId: number | null;
  leadUuid: string | null;
  leadName: string | null;
  receivesConversations: boolean;
  receivesRecords: boolean;
  isScopeBoundary: boolean;
  businessHours: unknown;
  timezone: string | null;
  defaultAssigneeUuid: string | null;
  defaultAssigneeName: string | null;
  rowVersion: number;
  createdAt: Date;
  /** The same instant at the database's microsecond precision, for the cursor. */
  createdAtIso: string;
}

export interface TeamMemberRow {
  teamId: number;
  userId: number;
  userUuid: string;
  fullName: string;
  presence: string | null;
  role: 'member' | 'lead';
  isPrimary: boolean;
  capacity: number;
}

export interface TeamUsageRow {
  teamId: number;
  routingRules: number;
  assignmentRules: number;
  segmentShares: number;
  childTeams: number;
  conversations: number;
}

export interface TeamListFilter {
  limit: number;
  cursor?: string;
  order: 'asc' | 'desc';
  q?: string;
}

const COLUMNS = sql`t.id, t.uuid, t.name, t.slug, t.color, t.description, t.assignment_strategy, t.is_default, t.sort,
  t.device_ids, t.parent_team_id, pt.uuid AS parent_uuid,
  (WITH RECURSIVE up AS (
     SELECT x.id, x.parent_team_id, 1 AS d FROM teams x WHERE x.org_id = t.org_id AND x.id = t.id
     UNION ALL
     SELECT p.id, p.parent_team_id, up.d + 1 FROM teams p
       JOIN up ON p.org_id = t.org_id AND p.id = up.parent_team_id WHERE up.d < 60)
   SELECT max(d) FROM up) AS depth,
  t.lead_user_id, lu.uuid AS lead_uuid, lu.full_name AS lead_name,
  t.receives_conversations, t.receives_records, t.is_scope_boundary,
  t.business_hours, t.timezone, du.uuid AS default_assignee_uuid, du.full_name AS default_assignee_name,
  t.row_version, t.created_at,
  to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso`;

const FROM = sql`FROM teams t
  LEFT JOIN teams pt ON pt.org_id = t.org_id AND pt.id = t.parent_team_id
  LEFT JOIN users lu ON lu.org_id = t.org_id AND lu.id = t.lead_user_id AND lu.status <> 'inactive'
  LEFT JOIN users du ON du.org_id = t.org_id AND du.id = t.default_assignee_id AND du.status <> 'inactive'`;

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
  parentId:
    r.parent_team_id === null || r.parent_team_id === undefined ? null : Number(r.parent_team_id),
  parentUuid: (r.parent_uuid as string | null) ?? null,
  depth: Number(r.depth ?? 1),
  leadUserId: r.lead_uuid ? Number(r.lead_user_id) : null,
  leadUuid: (r.lead_uuid as string | null) ?? null,
  leadName: (r.lead_name as string | null) ?? null,
  receivesConversations: Boolean(r.receives_conversations),
  receivesRecords: Boolean(r.receives_records),
  isScopeBoundary: Boolean(r.is_scope_boundary),
  businessHours: r.business_hours ?? null,
  timezone: (r.timezone as string | null) ?? null,
  defaultAssigneeUuid: (r.default_assignee_uuid as string | null) ?? null,
  defaultAssigneeName: (r.default_assignee_name as string | null) ?? null,
  rowVersion: Number(r.row_version),
  createdAt: toDate(r.created_at)!,
  createdAtIso: String(r.created_at_iso),
});

const idList = (ids: number[]): SQL =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );

/** Everything a caller may change about a team row. `undefined` leaves a column alone, `null` clears the nullable ones. */
export interface TeamChanges {
  name?: string;
  color?: string;
  description?: string | null;
  assignmentStrategy?: string;
  deviceIds?: string[];
  parentId?: number | null;
  leadUserId?: number | null;
  receivesConversations?: boolean;
  receivesRecords?: boolean;
}

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
      SELECT ${COLUMNS} ${FROM} WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY ${f.order === 'desc' ? sql`t.created_at DESC, t.id DESC` : sql`t.created_at ASC, t.id ASC`}
      LIMIT ${f.limit + 1}`);
    return (res.rows as Raw[]).map(toTeam);
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<TeamRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} ${FROM} WHERE t.org_id = ${orgId} AND t.uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as Raw | undefined;
    return row ? toTeam(row) : undefined;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<TeamRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} ${FROM} WHERE t.org_id = ${orgId} AND t.id = ${id}`,
    );
    const row = res.rows[0] as Raw | undefined;
    return row ? toTeam(row) : undefined;
  }

  /** The team's raw manager choice, even when that person is deactivated (the response hides it, the choice is kept). */
  async rawLeadUserId(tx: Tx, orgId: number, id: number): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT lead_user_id FROM teams WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const v = (res.rows[0] as Raw | undefined)?.lead_user_id;
    return v === null || v === undefined ? null : Number(v);
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
      parentId: number | null;
      receivesConversations: boolean;
      receivesRecords: boolean;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO teams (org_id, name, slug, color, description, assignment_strategy, device_ids, parent_team_id,
                         receives_conversations, receives_records)
      VALUES (${orgId}, ${v.name}, ${v.slug}, ${v.color}, ${v.description}, ${v.assignmentStrategy},
              ${v.deviceIds.length > 0 ? JSON.stringify(v.deviceIds) : null}::jsonb, ${v.parentId},
              ${v.receivesConversations}, ${v.receivesRecords})
      RETURNING id`);
    return Number((res.rows[0] as Raw).id);
  }

  /** Applies the changed fields when the row version still matches; false means somebody changed the team first. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expected: number,
    v: TeamChanges,
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
    if (v.parentId !== undefined) sets.push(sql`parent_team_id = ${v.parentId}`);
    if (v.leadUserId !== undefined) sets.push(sql`lead_user_id = ${v.leadUserId}`);
    if (v.receivesConversations !== undefined)
      sets.push(sql`receives_conversations = ${v.receivesConversations}`);
    if (v.receivesRecords !== undefined) sets.push(sql`receives_records = ${v.receivesRecords}`);
    const res = await tx.execute(sql`
      UPDATE teams SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expected} RETURNING id`);
    return res.rows.length > 0;
  }

  /** Sets or clears the manager without the optimistic-lock check (a member change that must keep the manager consistent). */
  async setLeadRaw(tx: Tx, orgId: number, id: number, userId: number | null): Promise<void> {
    await tx.execute(
      sql`UPDATE teams SET lead_user_id = ${userId} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** Members go with the team (cascade); conversations assigned to it lose the team (ON DELETE SET NULL); children move up a level. */
  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM teams WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- hierarchy --------------------------------------------------------------------------------------------------------------

  /** The team and every team below it (ids). Used to refuse a parent that is the team itself or one of its descendants. */
  async subtreeIds(tx: Tx, orgId: number, id: number): Promise<number[]> {
    const res = await tx.execute(sql`
      WITH RECURSIVE below AS (
        SELECT id, 1 AS d FROM teams WHERE org_id = ${orgId} AND id = ${id}
        UNION ALL
        SELECT c.id, below.d + 1 FROM teams c
          JOIN below ON c.org_id = ${orgId} AND c.parent_team_id = below.id WHERE below.d < 60)
      SELECT id FROM below`);
    return (res.rows as Raw[]).map((r) => Number(r.id));
  }

  /** Levels of the tree below this team, the team itself counting as 1 (a leaf is 1). */
  async heightBelow(tx: Tx, orgId: number, id: number): Promise<number> {
    const res = await tx.execute(sql`
      WITH RECURSIVE below AS (
        SELECT id, 1 AS d FROM teams WHERE org_id = ${orgId} AND id = ${id}
        UNION ALL
        SELECT c.id, below.d + 1 FROM teams c
          JOIN below ON c.org_id = ${orgId} AND c.parent_team_id = below.id WHERE below.d < 60)
      SELECT max(d) AS h FROM below`);
    return Number((res.rows[0] as Raw | undefined)?.h ?? 1);
  }

  /** Levels from the top down to this team (a top-level team is 1). */
  async depthOf(tx: Tx, orgId: number, id: number): Promise<number> {
    const res = await tx.execute(sql`
      WITH RECURSIVE up AS (
        SELECT id, parent_team_id, 1 AS d FROM teams WHERE org_id = ${orgId} AND id = ${id}
        UNION ALL
        SELECT p.id, p.parent_team_id, up.d + 1 FROM teams p
          JOIN up ON p.org_id = ${orgId} AND p.id = up.parent_team_id WHERE up.d < 60)
      SELECT max(d) AS d FROM up`);
    return Number((res.rows[0] as Raw | undefined)?.d ?? 1);
  }

  // --- usage ------------------------------------------------------------------------------------------------------------------

  /** Where each team is used. Rule actions keep team uuids inside JSON, so those are matched on the uuid text. */
  async usage(tx: Tx, orgId: number, teamIds: number[]): Promise<TeamUsageRow[]> {
    if (teamIds.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT t.id,
        (SELECT count(*)::int FROM routing_rules r
           WHERE r.org_id = t.org_id AND position(t.uuid::text in r.actions::text) > 0) AS routing_rules,
        (SELECT count(*)::int FROM assignment_rules a
           WHERE a.org_id = t.org_id AND a.team_ids @> to_jsonb(t.uuid::text)) AS assignment_rules,
        (SELECT count(*)::int FROM segment_shares s WHERE s.org_id = t.org_id AND s.team_id = t.id) AS segment_shares,
        (SELECT count(*)::int FROM teams c WHERE c.org_id = t.org_id AND c.parent_team_id = t.id) AS child_teams,
        (SELECT count(*)::int FROM conversations v WHERE v.org_id = t.org_id AND v.assignee_team_id = t.id) AS conversations
      FROM teams t WHERE t.org_id = ${orgId} AND t.id IN (${idList(teamIds)})`);
    return (res.rows as Raw[]).map((r) => ({
      teamId: Number(r.id),
      routingRules: Number(r.routing_rules),
      assignmentRules: Number(r.assignment_rules),
      segmentShares: Number(r.segment_shares),
      childTeams: Number(r.child_teams),
      conversations: Number(r.conversations),
    }));
  }

  // --- people -----------------------------------------------------------------------------------------------------------------

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
      SELECT tm.team_id, u.id AS user_id, u.uuid AS user_uuid, u.full_name, tm.role, tm.is_primary, tm.capacity,
             a.status AS presence_status
      FROM team_members tm
      JOIN users u ON u.org_id = tm.org_id AND u.id = tm.user_id AND u.status <> 'inactive'
      LEFT JOIN agent_statuses a ON a.org_id = u.org_id AND a.user_id = u.id
      WHERE tm.org_id = ${orgId} AND tm.team_id IN (${idList(teamIds)})
      ORDER BY lower(u.full_name), u.id`);
    return (res.rows as Raw[]).map((r) => ({
      teamId: Number(r.team_id),
      userId: Number(r.user_id),
      userUuid: String(r.user_uuid),
      fullName: String(r.full_name),
      presence: (r.presence_status as string | null) ?? null,
      role: r.role === 'lead' ? 'lead' : 'member',
      isPrimary: Boolean(r.is_primary),
      capacity: Number(r.capacity),
    }));
  }

  async isMember(tx: Tx, orgId: number, teamId: number, userId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM team_members WHERE org_id = ${orgId} AND team_id = ${teamId} AND user_id = ${userId}`);
    return res.rows.length > 0;
  }

  /**
   * `sync()`: members not in the list leave, new ones join as plain members, kept ones keep their role, capacity and primary mark.
   * Returns the people whose membership changed, so the caller can settle their primary team.
   */
  async syncMembers(tx: Tx, orgId: number, teamId: number, userIds: number[]): Promise<number[]> {
    const gone =
      userIds.length === 0
        ? await tx.execute(sql`
            DELETE FROM team_members WHERE org_id = ${orgId} AND team_id = ${teamId} RETURNING user_id`)
        : await tx.execute(sql`
            DELETE FROM team_members
            WHERE org_id = ${orgId} AND team_id = ${teamId} AND user_id NOT IN (${idList(userIds)})
            RETURNING user_id`);
    const joined =
      userIds.length === 0
        ? { rows: [] as Raw[] }
        : await tx.execute(sql`
            INSERT INTO team_members (org_id, team_id, user_id)
            SELECT ${orgId}, ${teamId}, u FROM unnest(ARRAY[${idList(userIds)}]::bigint[]) AS u
            ON CONFLICT (org_id, team_id, user_id) DO NOTHING
            RETURNING user_id`);
    return [...(gone.rows as Raw[]), ...(joined.rows as Raw[])].map((r) => Number(r.user_id));
  }

  /** Adds the person, or updates the role of one already on the team. */
  async upsertMember(
    tx: Tx,
    orgId: number,
    teamId: number,
    userId: number,
    role: 'member' | 'lead',
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO team_members (org_id, team_id, user_id, role)
      VALUES (${orgId}, ${teamId}, ${userId}, ${role})
      ON CONFLICT (org_id, team_id, user_id) DO UPDATE SET role = EXCLUDED.role`);
  }

  async setMemberRole(
    tx: Tx,
    orgId: number,
    teamId: number,
    userId: number,
    role: 'member' | 'lead',
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE team_members SET role = ${role}
      WHERE org_id = ${orgId} AND team_id = ${teamId} AND user_id = ${userId}`);
  }

  async removeMember(tx: Tx, orgId: number, teamId: number, userId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      DELETE FROM team_members WHERE org_id = ${orgId} AND team_id = ${teamId} AND user_id = ${userId}
      RETURNING user_id`);
    return res.rows.length > 0;
  }

  /** Makes this the person's primary team; their mark on any other team is cleared first (the unique index allows one). */
  async setPrimary(tx: Tx, orgId: number, teamId: number, userId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE team_members SET is_primary = false
      WHERE org_id = ${orgId} AND user_id = ${userId} AND is_primary AND team_id <> ${teamId}`);
    await tx.execute(sql`
      UPDATE team_members SET is_primary = true
      WHERE org_id = ${orgId} AND team_id = ${teamId} AND user_id = ${userId}`);
  }

  async clearPrimary(tx: Tx, orgId: number, teamId: number, userId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE team_members SET is_primary = false
      WHERE org_id = ${orgId} AND team_id = ${teamId} AND user_id = ${userId}`);
  }

  /**
   * A person on exactly one team has it as primary (the migration's rule, kept true afterwards); a person on several keeps what
   * they chose, or none. Called for everyone whose membership just changed.
   */
  async settlePrimary(tx: Tx, orgId: number, userIds: number[]): Promise<void> {
    if (userIds.length === 0) return;
    await tx.execute(sql`
      UPDATE team_members tm SET is_primary = true
      WHERE tm.org_id = ${orgId} AND tm.user_id IN (${idList(userIds)}) AND NOT tm.is_primary
        AND (SELECT count(*) FROM team_members o WHERE o.org_id = tm.org_id AND o.user_id = tm.user_id) = 1`);
  }
}
