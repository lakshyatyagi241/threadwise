import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import type { ModuleKey } from '@crm/contracts';

const { fields, fieldSections } = schema;

export interface FieldRow {
  id: number;
  uuid: string;
  moduleKey: string;
  sectionId: number | null;
  sectionUuid: string | null;
  key: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  isHidden: boolean;
  isReadOnly: boolean;
  isMasked: boolean;
  isUnique: boolean;
  isQuickCreate: boolean;
  isGlobalSearch: boolean;
  isSystem: boolean;
  isActive: boolean;
  position: number;
  config: Record<string, unknown>;
  replacesFieldId: number | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListFieldsFilter {
  moduleKey: ModuleKey;
  sectionId?: number;
  includeInactive: boolean;
}

/** Data access for `fields` — one org's Tier-2 custom-field definitions. */
@Injectable()
export class FieldsRepository {
  private selection() {
    return {
      id: fields.id,
      uuid: fields.uuid,
      moduleKey: fields.moduleKey,
      sectionId: fields.sectionId,
      sectionUuid: fieldSections.uuid,
      key: fields.key,
      label: fields.label,
      fieldType: fields.fieldType,
      isRequired: fields.isRequired,
      isHidden: fields.isHidden,
      isReadOnly: fields.isReadOnly,
      isMasked: fields.isMasked,
      isUnique: fields.isUnique,
      isQuickCreate: fields.isQuickCreate,
      isGlobalSearch: fields.isGlobalSearch,
      isSystem: fields.isSystem,
      isActive: fields.isActive,
      position: fields.position,
      config: fields.config,
      replacesFieldId: fields.replacesFieldId,
      rowVersion: fields.rowVersion,
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
    };
  }

  private baseQuery(tx: Tx) {
    return tx
      .select(this.selection())
      .from(fields)
      .leftJoin(
        fieldSections,
        and(eq(fieldSections.orgId, fields.orgId), eq(fieldSections.id, fields.sectionId)),
      );
  }

  async listByModule(tx: Tx, orgId: number, filter: ListFieldsFilter): Promise<FieldRow[]> {
    const conditions = [eq(fields.orgId, orgId), eq(fields.moduleKey, filter.moduleKey)];
    if (filter.sectionId !== undefined) conditions.push(eq(fields.sectionId, filter.sectionId));
    if (!filter.includeInactive) conditions.push(eq(fields.isActive, true));

    const rows = await this.baseQuery(tx)
      .where(and(...conditions))
      .orderBy(asc(fields.position), asc(fields.id));
    return rows as FieldRow[];
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<FieldRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(fields.orgId, orgId), eq(fields.uuid, uuid)),
    );
    return rows[0] as FieldRow | undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<FieldRow | undefined> {
    const rows = await this.baseQuery(tx).where(and(eq(fields.orgId, orgId), eq(fields.id, id)));
    return rows[0] as FieldRow | undefined;
  }

  async findByKey(
    tx: Tx,
    orgId: number,
    moduleKey: ModuleKey,
    key: string,
  ): Promise<FieldRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(fields.orgId, orgId), eq(fields.moduleKey, moduleKey), eq(fields.key, key)),
    );
    return rows[0] as FieldRow | undefined;
  }

  async nextPosition(
    tx: Tx,
    orgId: number,
    moduleKey: ModuleKey,
    sectionId: number,
  ): Promise<number> {
    const rows = await tx
      .select({ max: sql<number>`coalesce(max(${fields.position}), -1)` })
      .from(fields)
      .where(
        and(
          eq(fields.orgId, orgId),
          eq(fields.moduleKey, moduleKey),
          eq(fields.sectionId, sectionId),
        ),
      );
    return (rows[0]?.max ?? -1) + 1;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: {
      moduleKey: ModuleKey;
      sectionId: number;
      key: string;
      label: string;
      fieldType: string;
      isRequired: boolean;
      isHidden: boolean;
      isReadOnly: boolean;
      isMasked: boolean;
      isUnique: boolean;
      isQuickCreate: boolean;
      isGlobalSearch: boolean;
      config: Record<string, unknown>;
      position: number;
    },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(fields)
      .values({ orgId, uuid: sql`gen_random_uuid()`, ...values })
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
      .set(values)
      .where(
        and(eq(fields.orgId, orgId), eq(fields.id, id), eq(fields.rowVersion, expectedVersion)),
      )
      .returning({ id: fields.id });
    return result.length > 0;
  }

  async reorder(tx: Tx, orgId: number, orderedIds: number[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(fields)
        .set({ position: index })
        .where(and(eq(fields.orgId, orgId), eq(fields.id, id)));
    }
  }

  /** Soft delete — a field is versioned/deactivated, never hard-deleted (Phase 8 exit criteria). */
  async deactivate(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .update(fields)
      .set({ isActive: false })
      .where(and(eq(fields.orgId, orgId), eq(fields.id, id)))
      .returning({ id: fields.id });
    return result.length > 0;
  }

  /** Resolves a section's external uuid to its internal id. */
  async resolveSectionId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const rows = await tx
      .select({ id: fieldSections.id })
      .from(fieldSections)
      .where(and(eq(fieldSections.orgId, orgId), eq(fieldSections.uuid, uuid)));
    return rows[0]?.id;
  }
}
