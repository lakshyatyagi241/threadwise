import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';

const { fieldOptions, fields } = schema;

export interface FieldOptionRow {
  id: number;
  uuid: string;
  fieldId: number;
  fieldUuid: string;
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
      .where(and(eq(fieldOptions.orgId, orgId), sql`${fieldOptions.fieldId} = ANY(${fieldIds})`))
      .orderBy(asc(fieldOptions.position), asc(fieldOptions.id));

    const byField = new Map<number, FieldOptionRow[]>();
    for (const row of rows) {
      const list = byField.get(row.fieldId) ?? [];
      list.push(row);
      byField.set(row.fieldId, list);
    }
    return byField;
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
