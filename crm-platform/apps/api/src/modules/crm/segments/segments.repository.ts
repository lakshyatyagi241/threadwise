import { Injectable } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';
import { escapeLike } from '../contacts/contact-conditions';
import type { SegmentShareView } from './segments.mapper';

const { segments, segmentShares } = schema;

export type SegmentVisibilityValue = 'private' | 'shared' | 'specific';

export interface SegmentRow {
  id: number;
  uuid: string;
  /** created_at at microsecond precision (keyset cursor). */
  createdAtIso: string;
  name: string;
  description: string | null;
  color: string | null;
  visibility: SegmentVisibilityValue;
  /** The caller is on the list of a `specific` segment, directly or through a team (always false for other visibilities). */
  sharedWithMe: boolean;
  sharesRev: number;
  ownerId: number | null;
  ownerUuid: string | null;
  ownerName: string | null;
  rules: Record<string, unknown>;
  rulesVersion: number;
  memberCountCache: number | null;
  memberCountAt: Date | null;
  lastUsedAt: Date | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

interface RawRow {
  id: number | string;
  uuid: string;
  created_at_iso: string;
  name: string;
  description: string | null;
  color: string | null;
  visibility: SegmentVisibilityValue;
  shared_with_me: boolean;
  shares_rev: number;
  owner_id: number | string | null;
  owner_uuid: string | null;
  owner_name: string | null;
  rules: Record<string, unknown>;
  rules_version: number;
  member_count_cache: number | null;
  member_count_at: Date | string | null;
  last_used_at: Date | string | null;
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const toRow = (r: RawRow): SegmentRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  createdAtIso: r.created_at_iso,
  name: r.name,
  description: r.description,
  color: r.color,
  visibility: r.visibility,
  sharedWithMe: r.shared_with_me === true,
  sharesRev: Number(r.shares_rev),
  ownerId: r.owner_id === null ? null : Number(r.owner_id),
  ownerUuid: r.owner_uuid,
  ownerName: r.owner_name,
  rules: r.rules,
  rulesVersion: Number(r.rules_version),
  memberCountCache: r.member_count_cache === null ? null : Number(r.member_count_cache),
  memberCountAt: r.member_count_at ? new Date(r.member_count_at) : null,
  lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : null,
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

/** Who may see which segment: everything for an admin, else shared ones, the caller's own and those shared with them. */
export interface SegmentVisibility {
  userId: number | null;
  manageAll: boolean;
}

/**
 * Data access for segments. Every method takes the `tx` that already carries the tenant GUCs; the
 * `s.org_id` predicates are for the planner, RLS is the isolation.
 */
@Injectable()
export class SegmentsRepository {
  /**
   * Whether the caller (the `app.user_id` of the transaction) is on the list of a `specific` segment, by name or through a
   * team. Read here, in the row, so every path that decides visibility (`canSee`) sees the same answer as the list filter.
   */
  private readonly sharedWithMeSql = sql`(s.visibility = 'specific' AND EXISTS (
      SELECT 1 FROM segment_shares sh
      WHERE sh.org_id = s.org_id AND sh.segment_id = s.id
        AND (sh.user_id = current_actor_id()
             OR sh.team_id IN (SELECT tm.team_id FROM team_members tm
                               WHERE tm.org_id = s.org_id AND tm.user_id = current_actor_id()))
    ))`;

  private readonly selectSql = sql`
    SELECT s.id, s.uuid,
           to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
           s.name, s.description, s.color, s.visibility, ${this.sharedWithMeSql} AS shared_with_me,
           s.shares_rev, s.owner_id, u.uuid AS owner_uuid,
           u.full_name AS owner_name, s.rules, s.rules_version, s.member_count_cache,
           s.member_count_at, s.last_used_at, s.row_version, s.created_at, s.updated_at
    FROM segments s
    LEFT JOIN users u ON u.org_id = s.org_id AND u.id = s.owner_id
  `;

  private visibleSql(v: SegmentVisibility): SQL | undefined {
    if (v.manageAll) return undefined;
    return v.userId
      ? sql`(s.visibility = 'shared' OR s.owner_id = ${v.userId} OR ${this.sharedWithMeSql})`
      : sql`s.visibility = 'shared'`;
  }

  /** Newest first, `limit + 1` rows. */
  async list(
    tx: Tx,
    orgId: number,
    visibility: SegmentVisibility,
    filter: {
      limit: number;
      cursor?: string;
      order: 'asc' | 'desc';
      q?: string;
      visibility?: SegmentVisibilityValue;
      mine?: boolean;
    },
  ): Promise<SegmentRow[]> {
    const where: SQL[] = [sql`s.org_id = ${orgId}`];
    const seen = this.visibleSql(visibility);
    if (seen) where.push(seen);
    if (filter.q) where.push(sql`s.name ILIKE ${`%${escapeLike(filter.q)}%`}`);
    if (filter.visibility) where.push(sql`s.visibility = ${filter.visibility}`);
    if (filter.mine && visibility.userId) where.push(sql`s.owner_id = ${visibility.userId}`);
    if (filter.cursor) {
      const c = decodeCursor(filter.cursor);
      const iso = c.createdAtIso ?? c.createdAt.toISOString();
      where.push(
        filter.order === 'desc'
          ? sql`(s.created_at, s.id) < (${iso}::timestamptz, ${c.id}::bigint)`
          : sql`(s.created_at, s.id) > (${iso}::timestamptz, ${c.id}::bigint)`,
      );
    }
    const dir = filter.order === 'desc' ? sql`DESC` : sql`ASC`;
    const res = await tx.execute(sql`
      ${this.selectSql}
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY s.created_at ${dir}, s.id ${dir}
      LIMIT ${filter.limit + 1}
    `);
    return (res.rows as unknown as RawRow[]).map(toRow);
  }

  /** Every segment of the workspace regardless of visibility: for usage lookups, which filter afterwards. */
  async listAll(tx: Tx, orgId: number): Promise<SegmentRow[]> {
    const res = await tx.execute(
      sql`${this.selectSql} WHERE s.org_id = ${orgId} ORDER BY lower(s.name), s.id LIMIT 1000`,
    );
    return (res.rows as unknown as RawRow[]).map(toRow);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<SegmentRow | undefined> {
    const res = await tx.execute(
      sql`${this.selectSql} WHERE s.org_id = ${orgId} AND s.uuid = ${uuid}::uuid`,
    );
    const row = (res.rows as unknown as RawRow[])[0];
    return row ? toRow(row) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<SegmentRow | undefined> {
    const res = await tx.execute(sql`${this.selectSql} WHERE s.org_id = ${orgId} AND s.id = ${id}`);
    const row = (res.rows as unknown as RawRow[])[0];
    return row ? toRow(row) : undefined;
  }

  /** Insert, or nothing when a segment with that name (any case) exists: the unique index decides. */
  async insertIfAbsent(
    tx: Tx,
    orgId: number,
    v: {
      name: string;
      description: string | null;
      color: string | null;
      visibility: SegmentVisibilityValue;
      ownerId: number | null;
      rules: unknown;
      rulesVersion: number;
    },
  ): Promise<{ id: number; uuid: string } | undefined> {
    const res = await tx.execute(sql`
      INSERT INTO segments (org_id, name, description, color, visibility, owner_id, rules, rules_version)
      VALUES (${orgId}, ${v.name}, ${v.description}, ${v.color}, ${v.visibility}, ${v.ownerId},
              ${JSON.stringify(v.rules)}::jsonb, ${v.rulesVersion})
      ON CONFLICT (org_id, lower(name)) DO NOTHING
      RETURNING id, uuid
    `);
    const row = res.rows[0] as { id: number | string; uuid: string } | undefined;
    return row ? { id: Number(row.id), uuid: row.uuid } : undefined;
  }

  async findByName(tx: Tx, orgId: number, name: string): Promise<SegmentRow | undefined> {
    const res = await tx.execute(
      sql`${this.selectSql} WHERE s.org_id = ${orgId} AND lower(s.name) = lower(${name.trim()})`,
    );
    const row = (res.rows as unknown as RawRow[])[0];
    return row ? toRow(row) : undefined;
  }

  /** Optimistic update: zero rows means somebody else committed first. `row_version` itself is the trigger's. */
  async updateWithVersion(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    values: Partial<{
      name: string;
      description: string | null;
      color: string | null;
      visibility: SegmentVisibilityValue;
      rules: Record<string, unknown>;
      rulesVersion: number;
      memberCountCache: number | null;
      memberCountAt: Date | null;
      /** The people list changed: moves row_version even when no other column does. */
      sharesChanged: boolean;
    }>,
  ): Promise<boolean> {
    const { sharesChanged, ...columns } = values;
    const result = await tx
      .update(segments)
      .set({
        ...columns,
        ...(sharesChanged ? { sharesRev: sql`${segments.sharesRev} + 1` } : {}),
      })
      .where(
        and(
          eq(segments.orgId, orgId),
          eq(segments.id, id),
          eq(segments.rowVersion, expectedVersion),
        ),
      )
      .returning({ id: segments.id });
    return result.length > 0;
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(segments)
      .where(and(eq(segments.orgId, orgId), eq(segments.id, id)))
      .returning({ id: segments.id });
    return result.length > 0;
  }

  /** Stores a count and returns when (the database's clock). The trigger leaves row_version alone for this kind of write. */
  async storeCount(tx: Tx, orgId: number, id: number, count: number): Promise<Date | null> {
    const rows = await tx
      .update(segments)
      .set({ memberCountCache: count, memberCountAt: sql`now()` })
      .where(and(eq(segments.orgId, orgId), eq(segments.id, id)))
      .returning({ at: segments.memberCountAt });
    return rows[0]?.at ?? null;
  }

  /** Forgets the cached count of these segments (their rules just changed meaning); the next read recounts. */
  async resetCounts(tx: Tx, orgId: number, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.execute(sql`
      UPDATE segments SET member_count_cache = NULL, member_count_at = NULL
      WHERE org_id = ${orgId} AND id IN (${sql.join(
        ids.map((id) => sql`${id}::bigint`),
        sql`, `,
      )})
    `);
  }

  /** Marks the segment as used (at most once a minute), which is what keeps its count warm in the sweep. */
  async markUsed(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE segments SET last_used_at = now()
      WHERE org_id = ${orgId} AND id = ${id}
        AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')
    `);
  }

  // --- the people a `specific` segment is shared with ------------------------------------------------

  /** The ids on the list, as stored. */
  async shareTargets(
    tx: Tx,
    orgId: number,
    segmentId: number,
  ): Promise<{ userIds: number[]; teamIds: number[] }> {
    const rows = await tx
      .select({ userId: segmentShares.userId, teamId: segmentShares.teamId })
      .from(segmentShares)
      .where(and(eq(segmentShares.orgId, orgId), eq(segmentShares.segmentId, segmentId)));
    return {
      userIds: rows.flatMap((r) => (r.userId === null ? [] : [Number(r.userId)])),
      teamIds: rows.flatMap((r) => (r.teamId === null ? [] : [Number(r.teamId)])),
    };
  }

  /** Workspace members by uuid (an id from another workspace is simply not found). Suspended members are still members. */
  async usersByUuid(tx: Tx, orgId: number, uuids: readonly string[]): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT uuid, id FROM users WHERE org_id = ${orgId} AND uuid IN (${sql.join(
        uuids.map((u) => sql`${u}::uuid`),
        sql`, `,
      )})
    `);
    return new Map(
      (res.rows as Array<{ uuid: string; id: number | string }>).map((r) => [r.uuid, Number(r.id)]),
    );
  }

  async teamsByUuid(tx: Tx, orgId: number, uuids: readonly string[]): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT uuid, id FROM teams WHERE org_id = ${orgId} AND uuid IN (${sql.join(
        uuids.map((u) => sql`${u}::uuid`),
        sql`, `,
      )})
    `);
    return new Map(
      (res.rows as Array<{ uuid: string; id: number | string }>).map((r) => [r.uuid, Number(r.id)]),
    );
  }

  async addShares(
    tx: Tx,
    orgId: number,
    segmentId: number,
    targets: { userIds: number[]; teamIds: number[] },
  ): Promise<void> {
    const rows = [
      ...targets.userIds.map(
        (id) => sql`(${orgId}::bigint, ${segmentId}::bigint, ${id}::bigint, NULL::bigint)`,
      ),
      ...targets.teamIds.map(
        (id) => sql`(${orgId}::bigint, ${segmentId}::bigint, NULL::bigint, ${id}::bigint)`,
      ),
    ];
    if (rows.length === 0) return;
    await tx.execute(sql`
      INSERT INTO segment_shares (org_id, segment_id, user_id, team_id)
      VALUES ${sql.join(rows, sql`, `)}
      ON CONFLICT DO NOTHING
    `);
  }

  async removeShares(
    tx: Tx,
    orgId: number,
    segmentId: number,
    targets: { userIds: number[]; teamIds: number[] },
  ): Promise<void> {
    const parts: SQL[] = [];
    if (targets.userIds.length > 0) {
      parts.push(
        sql`user_id IN (${sql.join(
          targets.userIds.map((i) => sql`${i}::bigint`),
          sql`, `,
        )})`,
      );
    }
    if (targets.teamIds.length > 0) {
      parts.push(
        sql`team_id IN (${sql.join(
          targets.teamIds.map((i) => sql`${i}::bigint`),
          sql`, `,
        )})`,
      );
    }
    if (parts.length === 0) return;
    await tx.execute(sql`
      DELETE FROM segment_shares
      WHERE org_id = ${orgId} AND segment_id = ${segmentId} AND (${sql.join(parts, sql` OR `)})
    `);
  }

  /**
   * The people and teams of these segments, for the response. `withEmail` is for callers who can edit: a person the segment
   * is shared with learns who else sees it by name only.
   */
  async sharesFor(
    tx: Tx,
    orgId: number,
    segmentIds: readonly number[],
  ): Promise<Map<number, SegmentShareView>> {
    const out = new Map<number, SegmentShareView>();
    if (segmentIds.length === 0) return out;
    const ids = sql.join(
      segmentIds.map((i) => sql`${i}::bigint`),
      sql`, `,
    );
    const users = await tx.execute(sql`
      SELECT sh.segment_id, u.uuid, u.full_name, u.email::text AS email
      FROM segment_shares sh JOIN users u ON u.org_id = sh.org_id AND u.id = sh.user_id
      WHERE sh.org_id = ${orgId} AND sh.segment_id IN (${ids})
      ORDER BY lower(u.full_name), u.id
    `);
    const teams = await tx.execute(sql`
      SELECT sh.segment_id, t.uuid, t.name,
             (SELECT count(*)::int FROM team_members tm WHERE tm.org_id = t.org_id AND tm.team_id = t.id) AS members
      FROM segment_shares sh JOIN teams t ON t.org_id = sh.org_id AND t.id = sh.team_id
      WHERE sh.org_id = ${orgId} AND sh.segment_id IN (${ids})
      ORDER BY lower(t.name), t.id
    `);
    const slot = (id: number) => {
      let v = out.get(id);
      if (!v) out.set(id, (v = { users: [], teams: [] }));
      return v;
    };
    for (const r of users.rows as Array<Record<string, string | number>>) {
      slot(Number(r.segment_id)).users.push({
        uuid: String(r.uuid),
        name: String(r.full_name),
        email: String(r.email),
      });
    }
    for (const r of teams.rows as Array<Record<string, string | number>>) {
      slot(Number(r.segment_id)).teams.push({
        uuid: String(r.uuid),
        name: String(r.name),
        memberCount: Number(r.members),
      });
    }
    return out;
  }
}
