import { Injectable } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';
import { escapeLike } from '../contacts/contact-conditions';

const { segments } = schema;

export interface SegmentRow {
  id: number;
  uuid: string;
  /** created_at at microsecond precision (keyset cursor). */
  createdAtIso: string;
  name: string;
  description: string | null;
  color: string | null;
  visibility: 'private' | 'shared';
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
  visibility: 'private' | 'shared';
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

/** Who may see which segment: everything for an admin, else shared ones and the caller's own. */
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
  private readonly selectSql = sql`
    SELECT s.id, s.uuid,
           to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
           s.name, s.description, s.color, s.visibility, s.owner_id, u.uuid AS owner_uuid,
           u.full_name AS owner_name, s.rules, s.rules_version, s.member_count_cache,
           s.member_count_at, s.last_used_at, s.row_version, s.created_at, s.updated_at
    FROM segments s
    LEFT JOIN users u ON u.org_id = s.org_id AND u.id = s.owner_id
  `;

  private visibleSql(v: SegmentVisibility): SQL | undefined {
    if (v.manageAll) return undefined;
    return v.userId
      ? sql`(s.visibility = 'shared' OR s.owner_id = ${v.userId})`
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
      visibility?: 'private' | 'shared';
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
      visibility: 'private' | 'shared';
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
      visibility: 'private' | 'shared';
      rules: Record<string, unknown>;
      rulesVersion: number;
      memberCountCache: number | null;
      memberCountAt: Date | null;
    }>,
  ): Promise<boolean> {
    const result = await tx
      .update(segments)
      .set(values)
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
}
