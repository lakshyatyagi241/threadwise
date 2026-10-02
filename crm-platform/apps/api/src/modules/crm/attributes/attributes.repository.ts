import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';
import type { MergeContact } from './merge-tags';

const { fields } = schema;

export interface AttributeRow {
  id: number;
  uuid: string;
  key: string;
  label: string;
  fieldType: string;
  isSystem: boolean;
  isActive: boolean;
  config: Record<string, unknown>;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Data access for attributes: rows of the field registry that belong to contacts and are not
 * system fields. The default value and the description live in `config` (jsonb).
 */
@Injectable()
export class AttributesRepository {
  private selection() {
    return {
      id: fields.id,
      uuid: fields.uuid,
      key: fields.key,
      label: fields.label,
      fieldType: fields.fieldType,
      isSystem: fields.isSystem,
      isActive: fields.isActive,
      config: fields.config,
      rowVersion: fields.rowVersion,
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
    };
  }

  private base(orgId: number): SQL[] {
    return [eq(fields.orgId, orgId), eq(fields.moduleKey, 'contacts'), eq(fields.isSystem, false)];
  }

  /** Newest first, `limit + 1` rows. */
  async list(
    tx: Tx,
    orgId: number,
    filter: { limit: number; cursor?: string; q?: string; status: 'all' | 'active' | 'inactive' },
  ): Promise<AttributeRow[]> {
    const conditions = this.base(orgId);
    if (filter.status === 'active') conditions.push(eq(fields.isActive, true));
    if (filter.status === 'inactive') conditions.push(eq(fields.isActive, false));
    if (filter.q) {
      const like = `%${escapeLike(filter.q)}%`;
      conditions.push(
        or(
          sql`${fields.label} ILIKE ${like}`,
          sql`${fields.key} ILIKE ${like}`,
          sql`${fields.config}->>'description' ILIKE ${like}`,
        )!,
      );
    }
    if (filter.cursor) {
      const c = decodeCursor(filter.cursor);
      conditions.push(
        or(
          lt(fields.createdAt, c.createdAt),
          and(eq(fields.createdAt, c.createdAt), lt(fields.id, c.id)),
        )!,
      );
    }
    const rows = await tx
      .select(this.selection())
      .from(fields)
      .where(and(...conditions))
      .orderBy(desc(fields.createdAt), desc(fields.id))
      .limit(filter.limit + 1);
    return rows as AttributeRow[];
  }

  /** Every active attribute, for the picker, the catalogue and the resolver. */
  async listActive(tx: Tx, orgId: number): Promise<AttributeRow[]> {
    const rows = await tx
      .select(this.selection())
      .from(fields)
      .where(and(...this.base(orgId), eq(fields.isActive, true)))
      .orderBy(fields.label, fields.id);
    return rows as AttributeRow[];
  }

  async counts(tx: Tx, orgId: number): Promise<{ all: number; active: number; inactive: number }> {
    const rows = await tx
      .select({
        all: sql<number>`count(*)::int`,
        active: sql<number>`count(*) FILTER (WHERE ${fields.isActive})::int`,
      })
      .from(fields)
      .where(and(...this.base(orgId)));
    const all = Number(rows[0]?.all ?? 0);
    const active = Number(rows[0]?.active ?? 0);
    return { all, active, inactive: all - active };
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<AttributeRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(fields)
      .where(and(eq(fields.orgId, orgId), eq(fields.moduleKey, 'contacts'), eq(fields.uuid, uuid)));
    return rows[0] as AttributeRow | undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<AttributeRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(fields)
      .where(and(eq(fields.orgId, orgId), eq(fields.id, id)));
    return rows[0] as AttributeRow | undefined;
  }

  /** Any field of the contacts registry with this key, system or not. */
  async keyTaken(tx: Tx, orgId: number, key: string): Promise<boolean> {
    const rows = await tx
      .select({ id: fields.id })
      .from(fields)
      .where(and(eq(fields.orgId, orgId), eq(fields.moduleKey, 'contacts'), eq(fields.key, key)));
    return rows.length > 0;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: {
      sectionId: number;
      key: string;
      label: string;
      fieldType: string;
      isActive: boolean;
      config: Record<string, unknown>;
      position: number;
    },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(fields)
      .values({ orgId, uuid: sql`gen_random_uuid()`, moduleKey: 'contacts', ...values })
      .returning({ id: fields.id, uuid: fields.uuid });
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
      .update(fields)
      // an empty patch still has to be a valid UPDATE: it just touches the row
      .set(Object.keys(values).length > 0 ? values : { updatedAt: new Date() })
      .where(
        and(eq(fields.orgId, orgId), eq(fields.id, id), eq(fields.rowVersion, expectedVersion)),
      )
      .returning({ id: fields.id });
    return result.length > 0;
  }

  /** Hard delete (WaDesk's semantics); options and dependencies go with it by cascade. */
  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(fields)
      .where(and(eq(fields.orgId, orgId), eq(fields.id, id)))
      .returning({ id: fields.id });
    return result.length > 0;
  }

  /** Contacts holding a non-empty value under `key`. */
  async countContactsWithValue(tx: Tx, orgId: number, key: string): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM contacts
      WHERE org_id = ${orgId} AND jsonb_exists(data, ${key})
        AND coalesce(data ->> ${key}, '') <> ''
    `);
    return Number((res.rows[0] as { n: number }).n);
  }

  /** The section new attributes go under, created on first use. */
  async attributeSectionId(tx: Tx, orgId: number): Promise<number> {
    const found = await tx.execute(sql`
      SELECT id FROM field_sections
      WHERE org_id = ${orgId} AND module_key = 'contacts' AND name = 'Custom attributes'
      LIMIT 1
    `);
    const existing = found.rows[0] as { id: number } | undefined;
    if (existing) return Number(existing.id);
    const created = await tx.execute(sql`
      INSERT INTO field_sections (org_id, module_key, name, position)
      VALUES (${orgId}, 'contacts', 'Custom attributes',
              (SELECT coalesce(max(position), -1) + 1 FROM field_sections
                WHERE org_id = ${orgId} AND module_key = 'contacts'))
      RETURNING id
    `);
    return Number((created.rows[0] as { id: number }).id);
  }

  async nextPosition(tx: Tx, orgId: number, sectionId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT coalesce(max(position), -1) + 1 AS p FROM fields
      WHERE org_id = ${orgId} AND module_key = 'contacts' AND section_id = ${sectionId}
    `);
    return Number((res.rows[0] as { p: number }).p);
  }

  /** Newest contact: the sample values on the send screen's token chips. */
  async newestContact(tx: Tx, orgId: number): Promise<Record<string, unknown> | undefined> {
    const res = await tx.execute(sql`
      SELECT c.name, c.first_name AS "firstName", c.last_name AS "lastName",
             c.middle_name AS "middleName", c.title, c.phone, c.country_code AS "countryCode",
             c.email::text AS email, c.address, c.language, c.data,
             coalesce((SELECT string_agg(g.name, ', ' ORDER BY g.name)
                         FROM contact_group_members m
                         JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id
                        WHERE m.org_id = c.org_id AND m.contact_id = c.id), '') AS groups
      FROM contacts c WHERE c.org_id = ${orgId}
      ORDER BY c.created_at DESC, c.id DESC LIMIT 1
    `);
    return res.rows[0] as Record<string, unknown> | undefined;
  }

  /** Attribute keys that contacts carry in `data`, from the newest 200: the "Custom field" group. */
  async discoverDataKeys(tx: Tx, orgId: number): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT DISTINCT k AS key FROM (
        SELECT jsonb_object_keys(data) AS k FROM (
          SELECT data FROM contacts WHERE org_id = ${orgId} AND jsonb_typeof(data) = 'object'
          ORDER BY created_at DESC, id DESC LIMIT 200
        ) recent
      ) keys
      WHERE k ~ '^[A-Za-z_][A-Za-z0-9_.-]*$'
      ORDER BY k
    `);
    return (res.rows as Array<{ key: string }>).map((r) => r.key);
  }

  /** The columns a merge token can name, plus the attribute values, for one contact. */
  async contactForMerge(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<Omit<MergeContact, 'groups'> | undefined> {
    const res = await tx.execute(sql`
      SELECT name, first_name AS "firstName", middle_name AS "middleName", last_name AS "lastName",
             title, phone, country_code AS "countryCode", email::text AS email, address, language, data
      FROM contacts WHERE org_id = ${orgId} AND id = ${id}
    `);
    return res.rows[0] as Omit<MergeContact, 'groups'> | undefined;
  }

  async orgName(tx: Tx, orgId: number): Promise<string> {
    const res = await tx.execute(sql`SELECT name FROM organizations WHERE id = ${orgId}`);
    return String((res.rows[0] as { name?: string } | undefined)?.name ?? '');
  }
}
