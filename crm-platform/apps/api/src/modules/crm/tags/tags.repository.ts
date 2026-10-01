import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

const { tags, contactTags, contacts } = schema;

export interface TagRow {
  id: number;
  uuid: string;
  name: string;
  color: string | null;
  /** Only on a list asked for counts. */
  contactCount?: number;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListTagsFilter {
  limit: number;
  cursor?: string;
  q?: string;
  includeCounts?: boolean;
}

/** Data access for `tags` and their membership on contacts (`contact_tags`). */
@Injectable()
export class TagsRepository {
  private selection() {
    return {
      id: tags.id,
      uuid: tags.uuid,
      name: tags.name,
      color: tags.color,
      rowVersion: tags.rowVersion,
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt,
    };
  }

  /** Returns `limit + 1` rows; the caller turns the extra one into `hasMore`. */
  async list(tx: Tx, orgId: number, filter: ListTagsFilter): Promise<TagRow[]> {
    const conditions = [eq(tags.orgId, orgId)];
    if (filter.q) conditions.push(sql`${tags.name}::text ILIKE ${`%${filter.q}%`}`);

    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      conditions.push(
        or(
          lt(tags.createdAt, cursor.createdAt),
          and(eq(tags.createdAt, cursor.createdAt), lt(tags.id, cursor.id)),
        )!,
      );
    }

    const selection = filter.includeCounts
      ? {
          ...this.selection(),
          contactCount: sql<number>`(
            SELECT count(*)::int FROM contact_tags ct
            WHERE ct.org_id = ${tags.orgId} AND ct.tag_id = ${tags.id}
          )`.mapWith(Number),
        }
      : this.selection();
    const rows = await tx
      .select(selection)
      .from(tags)
      .where(and(...conditions))
      .orderBy(desc(tags.createdAt), desc(tags.id))
      .limit(filter.limit + 1);
    return rows as TagRow[];
  }

  /** Case-insensitive: `name` is citext, unique per org. */
  async findByName(tx: Tx, orgId: number, name: string): Promise<TagRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(tags)
      .where(and(eq(tags.orgId, orgId), sql`${tags.name} = ${name}`));
    return rows[0] as TagRow | undefined;
  }

  async countAll(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`SELECT count(*)::int AS n FROM tags WHERE org_id = ${orgId}`);
    return Number((res.rows[0] as { n: number }).n);
  }

  /** Insert, or nothing when the name (any case) is taken. */
  async insertIfAbsent(
    tx: Tx,
    orgId: number,
    values: { name: string; color?: string | null },
  ): Promise<{ id: number; uuid: string } | undefined> {
    const res = await tx.execute(sql`
      INSERT INTO tags (org_id, name, color)
      VALUES (${orgId}, ${values.name}, ${values.color ?? null})
      ON CONFLICT (org_id, name) DO NOTHING
      RETURNING id, uuid
    `);
    const row = res.rows[0] as { id: number; uuid: string } | undefined;
    return row ? { id: Number(row.id), uuid: row.uuid } : undefined;
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<TagRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(tags)
      .where(and(eq(tags.orgId, orgId), eq(tags.uuid, uuid)));
    return rows[0] as TagRow | undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<TagRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(tags)
      .where(and(eq(tags.orgId, orgId), eq(tags.id, id)));
    return rows[0] as TagRow | undefined;
  }

  async findManyByUuids(tx: Tx, orgId: number, uuids: string[]): Promise<TagRow[]> {
    if (uuids.length === 0) return [];
    const rows = await tx
      .select(this.selection())
      .from(tags)
      .where(and(eq(tags.orgId, orgId), inArray(tags.uuid, uuids)));
    return rows as TagRow[];
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: { name: string; color?: string | null },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(tags)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        name: values.name,
        color: values.color ?? null,
      })
      .returning({ id: tags.id, uuid: tags.uuid });
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
      .update(tags)
      // an empty patch still has to be a valid UPDATE: it just touches the row
      .set(Object.keys(values).length > 0 ? values : { updatedAt: new Date() })
      .where(and(eq(tags.orgId, orgId), eq(tags.id, id), eq(tags.rowVersion, expectedVersion)))
      .returning({ id: tags.id });
    return result.length > 0;
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(tags)
      .where(and(eq(tags.orgId, orgId), eq(tags.id, id)))
      .returning({ id: tags.id });
    return result.length > 0;
  }

  /** Resolves contact uuids to internal ids, keyed by the uuid the caller passed in. A uuid missing from the result does not exist in this org. */
  async resolveContactIdMap(tx: Tx, orgId: number, uuids: string[]): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const rows = await tx
      .select({ id: contacts.id, uuid: contacts.uuid })
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), inArray(contacts.uuid, uuids)));
    return new Map(rows.map((r) => [r.uuid, r.id]));
  }

  /** Attach — idempotent, a re-attach of an already-tagged contact is a no-op. */
  async attach(
    tx: Tx,
    orgId: number,
    contactIds: number[],
    tagIds: number[],
    createdBy: number | null,
  ): Promise<Array<{ contactId: number; tagId: number }>> {
    const added: Array<{ contactId: number; tagId: number }> = [];
    for (const contactId of contactIds) {
      for (const tagId of tagIds) {
        const rows = await tx
          .insert(contactTags)
          .values({ orgId, contactId, tagId, createdBy })
          .onConflictDoNothing()
          .returning({ contactId: contactTags.contactId, tagId: contactTags.tagId });
        if (rows[0]) added.push(rows[0]);
      }
    }
    return added;
  }

  async detach(tx: Tx, orgId: number, contactId: number, tagId: number): Promise<boolean> {
    const result = await tx
      .delete(contactTags)
      .where(
        and(
          eq(contactTags.orgId, orgId),
          eq(contactTags.contactId, contactId),
          eq(contactTags.tagId, tagId),
        ),
      )
      .returning({ tagId: contactTags.tagId });
    return result.length > 0;
  }

  async listByContact(tx: Tx, orgId: number, contactId: number): Promise<TagRow[]> {
    const rows = await tx
      .select(this.selection())
      .from(contactTags)
      .innerJoin(tags, and(eq(tags.orgId, contactTags.orgId), eq(tags.id, contactTags.tagId)))
      .where(and(eq(contactTags.orgId, orgId), eq(contactTags.contactId, contactId)))
      .orderBy(asc(tags.name));
    return rows as TagRow[];
  }
}
