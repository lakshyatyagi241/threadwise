import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { escapeLike } from '../contacts/contact-predicates';

const { fieldOptions, fields } = schema;

export interface FieldOptionRow {
  id: number;
  uuid: string;
  fieldId: number;
  fieldUuid: string;
  /** The owning field's moduleKey — field_options carries no module_key of its own. */
  moduleKey: string;
  value: string;
  label: string;
  position: number;
  isHidden: boolean;
  rowVersion: number;
}

/** Data access for `field_options` — the choice list behind select/multiselect/radio fields. */
@Injectable()
export class FieldOptionsRepository {
  private selection() {
    return {
      id: fieldOptions.id,
      uuid: fieldOptions.uuid,
      fieldId: fieldOptions.fieldId,
      fieldUuid: fields.uuid,
      moduleKey: fields.moduleKey,
      value: fieldOptions.value,
      label: fieldOptions.label,
      position: fieldOptions.position,
      isHidden: fieldOptions.isHidden,
      rowVersion: fieldOptions.rowVersion,
    };
  }

  private baseQuery(tx: Tx) {
    return tx
      .select(this.selection())
      .from(fieldOptions)
      .innerJoin(
        fields,
        and(eq(fields.orgId, fieldOptions.orgId), eq(fields.id, fieldOptions.fieldId)),
      );
  }

  async listByField(tx: Tx, orgId: number, fieldId: number): Promise<FieldOptionRow[]> {
    const rows = await this.baseQuery(tx)
      .where(and(eq(fieldOptions.orgId, orgId), eq(fieldOptions.fieldId, fieldId)))
      .orderBy(asc(fieldOptions.position), asc(fieldOptions.id));
    return rows;
  }

  /** For every field in one listing call — one query, grouped in memory. */
  async listByFieldIds(
    tx: Tx,
    orgId: number,
    fieldIds: number[],
  ): Promise<Map<number, FieldOptionRow[]>> {
    if (fieldIds.length === 0) return new Map();
    const rows = await this.baseQuery(tx)
      .where(and(eq(fieldOptions.orgId, orgId), inArray(fieldOptions.fieldId, fieldIds)))
      .orderBy(asc(fieldOptions.position), asc(fieldOptions.id));

    const byField = new Map<number, FieldOptionRow[]>();
    for (const row of rows) {
      const list = byField.get(row.fieldId) ?? [];
      list.push(row);
      byField.set(row.fieldId, list);
    }
    return byField;
  }

  /** How many options each of the fields has (a field with none is absent): one grouped query for a whole field list. */
  async countByFieldIds(tx: Tx, orgId: number, fieldIds: number[]): Promise<Map<number, number>> {
    if (fieldIds.length === 0) return new Map();
    const rows = await tx
      .select({ fieldId: fieldOptions.fieldId, n: sql<number>`count(*)::int` })
      .from(fieldOptions)
      .where(and(eq(fieldOptions.orgId, orgId), inArray(fieldOptions.fieldId, fieldIds)))
      .groupBy(fieldOptions.fieldId);
    return new Map(rows.map((r) => [r.fieldId, Number(r.n)]));
  }

  /**
   * One page of a field's options for a search box, in the field's own order (position, then id; keyset, so a page never repeats or
   * skips under a concurrent edit). `values` reads exactly those stored values, hidden options included; otherwise hidden options
   * are left out and `q` keeps the ones whose label or value contains it.
   */
  async search(
    tx: Tx,
    orgId: number,
    fieldId: number,
    p: { q?: string; values?: string[]; limit: number; cursor?: string },
  ): Promise<{ rows: FieldOptionRow[]; nextCursor: string | null }> {
    const conditions: SQL[] = [eq(fieldOptions.orgId, orgId), eq(fieldOptions.fieldId, fieldId)];
    if (p.values && p.values.length > 0) {
      conditions.push(inArray(fieldOptions.value, p.values));
    } else {
      conditions.push(eq(fieldOptions.isHidden, false));
      const q = p.q?.trim();
      if (q) {
        const like = `%${escapeLike(q)}%`;
        conditions.push(
          or(sql`${fieldOptions.label} ILIKE ${like}`, sql`${fieldOptions.value} ILIKE ${like}`)!,
        );
      }
    }
    if (p.cursor) {
      const after = decodeOptionCursor(p.cursor);
      conditions.push(
        sql`(${fieldOptions.position}, ${fieldOptions.id}) > (${after.position}, ${after.id})`,
      );
    }
    const rows = await this.baseQuery(tx)
      .where(and(...conditions))
      .orderBy(asc(fieldOptions.position), asc(fieldOptions.id))
      .limit(p.limit + 1);
    const page = rows.slice(0, p.limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor:
        rows.length > p.limit && last
          ? Buffer.from(`${last.position}|${last.id}`, 'utf8').toString('base64url')
          : null,
    };
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<FieldOptionRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(fieldOptions.orgId, orgId), eq(fieldOptions.id, id)),
    );
    return rows[0];
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<FieldOptionRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(fieldOptions.orgId, orgId), eq(fieldOptions.uuid, uuid)),
    );
    return rows[0];
  }

  /** uuid -> row for every uuid that exists in the workspace, in one query. Unknown uuids are absent. */
  async findByUuids(tx: Tx, orgId: number, uuids: string[]): Promise<Map<string, FieldOptionRow>> {
    if (uuids.length === 0) return new Map();
    const rows = await this.baseQuery(tx).where(
      and(eq(fieldOptions.orgId, orgId), inArray(fieldOptions.uuid, uuids)),
    );
    return new Map(rows.map((r) => [r.uuid, r]));
  }

  async nextPosition(tx: Tx, orgId: number, fieldId: number): Promise<number> {
    const rows = await tx
      .select({ max: sql<number>`coalesce(max(${fieldOptions.position}), -1)` })
      .from(fieldOptions)
      .where(and(eq(fieldOptions.orgId, orgId), eq(fieldOptions.fieldId, fieldId)));
    return (rows[0]?.max ?? -1) + 1;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: { fieldId: number; value: string; label: string; position: number },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(fieldOptions)
      .values({ orgId, uuid: sql`gen_random_uuid()`, ...values })
      .returning({ id: fieldOptions.id, uuid: fieldOptions.uuid });
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
      .update(fieldOptions)
      .set(values)
      .where(
        and(
          eq(fieldOptions.orgId, orgId),
          eq(fieldOptions.id, id),
          eq(fieldOptions.rowVersion, expectedVersion),
        ),
      )
      .returning({ id: fieldOptions.id });
    return result.length > 0;
  }

  async reorder(tx: Tx, orgId: number, orderedIds: number[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(fieldOptions)
        .set({ position: index })
        .where(and(eq(fieldOptions.orgId, orgId), eq(fieldOptions.id, id)));
    }
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(fieldOptions)
      .where(and(eq(fieldOptions.orgId, orgId), eq(fieldOptions.id, id)))
      .returning({ id: fieldOptions.id });
    return result.length > 0;
  }
}

function decodeOptionCursor(raw: string): { position: number; id: number } {
  const [position, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const parsed = { position: Number(position), id: Number(id) };
  if (!Number.isSafeInteger(parsed.position) || !Number.isSafeInteger(parsed.id)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
  return parsed;
}
