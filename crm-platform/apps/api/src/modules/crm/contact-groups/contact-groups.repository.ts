import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

const { contactGroups, contactGroupMembers } = schema;

export interface ContactGroupRow {
  id: number;
  uuid: string;
  name: string;
  note: string | null;
  color: string | null;
  memberCount: number;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

interface RawGroupRow {
  id: number;
  uuid: string;
  name: string;
  note: string | null;
  color: string | null;
  member_count: number;
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const toRow = (r: RawGroupRow): ContactGroupRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  name: r.name,
  note: r.note,
  color: r.color,
  memberCount: Number(r.member_count),
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

/** Escapes LIKE wildcards in what the user typed. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Data access for contact groups and their membership.
 *
 * The member count is computed with the read (an index-only count over
 * contact_group_members), never stored: a stored counter is one more thing a bulk import, a
 * dedupe merge and a contact delete would each have to keep right.
 */
@Injectable()
export class ContactGroupsRepository {
  private readonly selectSql = sql`
    SELECT g.id, g.uuid, g.name, g.note, g.color, g.row_version, g.created_at, g.updated_at,
           (SELECT count(*) FROM contact_group_members m
             WHERE m.org_id = g.org_id AND m.group_id = g.id)::int AS member_count
    FROM contact_groups g
  `;

  /** Newest first, `limit + 1` rows. */
  async list(
    tx: Tx,
    orgId: number,
    filter: { limit: number; cursor?: string; q?: string },
  ): Promise<ContactGroupRow[]> {
    const conditions = [sql`g.org_id = ${orgId}`];
    if (filter.q) conditions.push(sql`g.name ILIKE ${`%${escapeLike(filter.q)}%`}`);
    if (filter.cursor) {
      const c = decodeCursor(filter.cursor);
      conditions.push(
        sql`(g.created_at, g.id) < (${c.createdAt.toISOString()}::timestamptz, ${c.id}::bigint)`,
      );
    }
    const res = await tx.execute(sql`
      ${this.selectSql}
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT ${filter.limit + 1}
    `);
    return (res.rows as unknown as RawGroupRow[]).map(toRow);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ContactGroupRow | undefined> {
    const res = await tx.execute(
      sql`${this.selectSql} WHERE g.org_id = ${orgId} AND g.uuid = ${uuid}::uuid`,
    );
    const row = (res.rows as unknown as RawGroupRow[])[0];
    return row ? toRow(row) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ContactGroupRow | undefined> {
    const res = await tx.execute(sql`${this.selectSql} WHERE g.org_id = ${orgId} AND g.id = ${id}`);
    const row = (res.rows as unknown as RawGroupRow[])[0];
    return row ? toRow(row) : undefined;
  }

  /** Case-insensitive, trimmed: the same comparison the unique index makes. */
  async findByName(tx: Tx, orgId: number, name: string): Promise<ContactGroupRow | undefined> {
    const res = await tx.execute(
      sql`${this.selectSql} WHERE g.org_id = ${orgId} AND lower(g.name) = lower(${name.trim()})`,
    );
    const row = (res.rows as unknown as RawGroupRow[])[0];
    return row ? toRow(row) : undefined;
  }

  /**
   * Insert, or nothing when a group with that name (any case) already exists. The unique index
   * decides, so two simultaneous creates cannot both succeed.
   */
  async insertIfAbsent(
    tx: Tx,
    orgId: number,
    values: { name: string; note?: string | null; color?: string | null; createdBy: number | null },
  ): Promise<{ id: number; uuid: string } | undefined> {
    const res = await tx.execute(sql`
      INSERT INTO contact_groups (org_id, name, note, color, created_by)
      VALUES (${orgId}, ${values.name}, ${values.note ?? null}, ${values.color ?? null}, ${values.createdBy})
      ON CONFLICT (org_id, lower(name)) DO NOTHING
      RETURNING id, uuid
    `);
    const row = res.rows[0] as { id: number; uuid: string } | undefined;
    return row ? { id: Number(row.id), uuid: row.uuid } : undefined;
  }

  /** Optimistic update. Zero rows means somebody else committed first. */
  async updateWithVersion(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    values: { name?: string; note?: string | null; color?: string | null },
  ): Promise<boolean> {
    const result = await tx
      .update(contactGroups)
      // an empty patch still has to be a valid UPDATE: it just touches the row
      .set(Object.keys(values).length > 0 ? values : { updatedAt: new Date() })
      .where(
        and(
          eq(contactGroups.orgId, orgId),
          eq(contactGroups.id, id),
          eq(contactGroups.rowVersion, expectedVersion),
        ),
      )
      .returning({ id: contactGroups.id });
    return result.length > 0;
  }

  /** Members detach through the FK's ON DELETE CASCADE; contacts are untouched. */
  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(contactGroups)
      .where(and(eq(contactGroups.orgId, orgId), eq(contactGroups.id, id)))
      .returning({ id: contactGroups.id });
    return result.length > 0;
  }

  /** uuid -> internal id for a set of groups. A uuid missing from the map is not in this org. */
  async resolveIds(tx: Tx, orgId: number, uuids: string[]): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const rows = await tx
      .select({ id: contactGroups.id, uuid: contactGroups.uuid })
      .from(contactGroups)
      .where(and(eq(contactGroups.orgId, orgId), inArray(contactGroups.uuid, uuids)));
    return new Map(rows.map((r) => [r.uuid, r.id]));
  }

  async groupsOfContact(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<Array<{ id: number; uuid: string; name: string; color: string | null }>> {
    const res = await tx.execute(sql`
      SELECT g.id, g.uuid, g.name, g.color
      FROM contact_group_members m
      JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id
      WHERE m.org_id = ${orgId} AND m.contact_id = ${contactId}
      ORDER BY lower(g.name)
    `);
    return (
      res.rows as unknown as Array<{ id: number; uuid: string; name: string; color: string | null }>
    ).map((r) => ({ ...r, id: Number(r.id) }));
  }

  /**
   * Make the contact's membership exactly `groupIds`. Returns what changed so the caller can
   * emit one event per added and removed group.
   */
  async replaceMembership(
    tx: Tx,
    orgId: number,
    contactId: number,
    groupIds: number[],
  ): Promise<{ added: number[]; removed: number[] }> {
    const current = await tx
      .select({ groupId: contactGroupMembers.groupId })
      .from(contactGroupMembers)
      .where(
        and(eq(contactGroupMembers.orgId, orgId), eq(contactGroupMembers.contactId, contactId)),
      );
    const have = new Set(current.map((c) => c.groupId));
    const want = new Set(groupIds);
    const added = [...want].filter((id) => !have.has(id));
    const removed = [...have].filter((id) => !want.has(id));

    if (removed.length > 0) {
      await tx
        .delete(contactGroupMembers)
        .where(
          and(
            eq(contactGroupMembers.orgId, orgId),
            eq(contactGroupMembers.contactId, contactId),
            inArray(contactGroupMembers.groupId, removed),
          ),
        );
    }
    if (added.length > 0) {
      await tx
        .insert(contactGroupMembers)
        .values(added.map((groupId) => ({ orgId, contactId, groupId })))
        .onConflictDoNothing();
    }
    return { added, removed };
  }
}
