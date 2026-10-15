import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import type { ModuleKey } from '@crm/contracts';

const { fieldSections } = schema;

export interface FieldSectionRow {
  id: number;
  uuid: string;
  moduleKey: string;
  name: string;
  position: number;
  isActive: boolean;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Data access for field_sections — the grouping shell fields render under
 * (e.g. "Contact Information", "Pre Book") in the Data Management UI.
 */
@Injectable()
export class FieldSectionsRepository {
  private selection() {
    return {
      id: fieldSections.id,
      uuid: fieldSections.uuid,
      moduleKey: fieldSections.moduleKey,
      name: fieldSections.name,
      position: fieldSections.position,
      isActive: fieldSections.isActive,
      rowVersion: fieldSections.rowVersion,
      createdAt: fieldSections.createdAt,
      updatedAt: fieldSections.updatedAt,
    };
  }

  /** Small, admin-configured list per org — no pagination, ordered by position. */
  async listByModule(tx: Tx, orgId: number, moduleKey: ModuleKey): Promise<FieldSectionRow[]> {
    const rows = await tx
      .select(this.selection())
      .from(fieldSections)
      .where(and(eq(fieldSections.orgId, orgId), eq(fieldSections.moduleKey, moduleKey)))
      .orderBy(asc(fieldSections.position), asc(fieldSections.id));
    return rows as FieldSectionRow[];
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<FieldSectionRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(fieldSections)
      .where(and(eq(fieldSections.orgId, orgId), eq(fieldSections.uuid, uuid)));
    return rows[0] as FieldSectionRow | undefined;
  }

  /** uuid -> row for every uuid that exists in the workspace, in one query. Unknown uuids are absent. */
  async findByUuids(tx: Tx, orgId: number, uuids: string[]): Promise<Map<string, FieldSectionRow>> {
    if (uuids.length === 0) return new Map();
    const rows = await tx
      .select(this.selection())
      .from(fieldSections)
      .where(and(eq(fieldSections.orgId, orgId), inArray(fieldSections.uuid, uuids)));
    return new Map((rows as FieldSectionRow[]).map((r) => [r.uuid, r]));
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<FieldSectionRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(fieldSections)
      .where(and(eq(fieldSections.orgId, orgId), eq(fieldSections.id, id)));
    return rows[0] as FieldSectionRow | undefined;
  }

  async nextPosition(tx: Tx, orgId: number, moduleKey: ModuleKey): Promise<number> {
    const rows = await tx
      .select({ max: sql<number>`coalesce(max(${fieldSections.position}), -1)` })
      .from(fieldSections)
      .where(and(eq(fieldSections.orgId, orgId), eq(fieldSections.moduleKey, moduleKey)));
    return (rows[0]?.max ?? -1) + 1;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: { moduleKey: ModuleKey; name: string; position: number },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(fieldSections)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        moduleKey: values.moduleKey,
        name: values.name,
        position: values.position,
      })
      .returning({ id: fieldSections.id, uuid: fieldSections.uuid });
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
      .update(fieldSections)
      .set(values)
      .where(
        and(
          eq(fieldSections.orgId, orgId),
          eq(fieldSections.id, id),
          eq(fieldSections.rowVersion, expectedVersion),
        ),
      )
      .returning({ id: fieldSections.id });
    return result.length > 0;
  }

  async reorder(tx: Tx, orgId: number, orderedIds: number[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(fieldSections)
        .set({ position: index })
        .where(and(eq(fieldSections.orgId, orgId), eq(fieldSections.id, id)));
    }
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(fieldSections)
      .where(and(eq(fieldSections.orgId, orgId), eq(fieldSections.id, id)))
      .returning({ id: fieldSections.id });
    return result.length > 0;
  }
}
