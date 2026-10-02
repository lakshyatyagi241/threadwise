import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import type { ModuleKey } from '@crm/contracts';
import type { ContactOptionColumn } from './status-option-columns';

const { statusOptions, contacts } = schema;

export interface StatusOptionRow {
  id: number;
  uuid: string;
  moduleKey: string;
  optionGroup: string;
  value: string;
  label: string;
  color: string | null;
  position: number;
  isDefault: boolean;
  isActive: boolean;
  rowVersion: number;
}

/**
 * Data access for `status_options` — org-extensible enum groups such as
 * lifecycle_stage and deal_status that render as pills/dropdowns in the UI.
 */
@Injectable()
export class StatusOptionsRepository {
  private selection() {
    return {
      id: statusOptions.id,
      uuid: statusOptions.uuid,
      moduleKey: statusOptions.moduleKey,
      optionGroup: statusOptions.optionGroup,
      value: statusOptions.value,
      label: statusOptions.label,
      color: statusOptions.color,
      position: statusOptions.position,
      isDefault: statusOptions.isDefault,
      isActive: statusOptions.isActive,
      rowVersion: statusOptions.rowVersion,
    };
  }

  async list(
    tx: Tx,
    orgId: number,
    moduleKey: ModuleKey,
    optionGroup?: string,
  ): Promise<StatusOptionRow[]> {
    const conditions = [eq(statusOptions.orgId, orgId), eq(statusOptions.moduleKey, moduleKey)];
    if (optionGroup) conditions.push(eq(statusOptions.optionGroup, optionGroup));

    return tx
      .select(this.selection())
      .from(statusOptions)
      .where(and(...conditions))
      .orderBy(asc(statusOptions.optionGroup), asc(statusOptions.position), asc(statusOptions.id));
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<StatusOptionRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(statusOptions)
      .where(and(eq(statusOptions.orgId, orgId), eq(statusOptions.uuid, uuid)));
    return rows[0];
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<StatusOptionRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(statusOptions)
      .where(and(eq(statusOptions.orgId, orgId), eq(statusOptions.id, id)));
    return rows[0];
  }

  async nextPosition(
    tx: Tx,
    orgId: number,
    moduleKey: ModuleKey,
    optionGroup: string,
  ): Promise<number> {
    const rows = await tx
      .select({ max: sql<number>`coalesce(max(${statusOptions.position}), -1)` })
      .from(statusOptions)
      .where(
        and(
          eq(statusOptions.orgId, orgId),
          eq(statusOptions.moduleKey, moduleKey),
          eq(statusOptions.optionGroup, optionGroup),
        ),
      );
    return (rows[0]?.max ?? -1) + 1;
  }

  /** Unsets the current default in this group — a group has at most one. */
  async clearDefault(
    tx: Tx,
    orgId: number,
    moduleKey: ModuleKey,
    optionGroup: string,
  ): Promise<void> {
    await tx
      .update(statusOptions)
      .set({ isDefault: false })
      .where(
        and(
          eq(statusOptions.orgId, orgId),
          eq(statusOptions.moduleKey, moduleKey),
          eq(statusOptions.optionGroup, optionGroup),
          eq(statusOptions.isDefault, true),
        ),
      );
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: {
      moduleKey: ModuleKey;
      optionGroup: string;
      value: string;
      label: string;
      color?: string | null;
      position: number;
      isDefault: boolean;
    },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(statusOptions)
      .values({ orgId, uuid: sql`gen_random_uuid()`, ...values })
      .returning({ id: statusOptions.id, uuid: statusOptions.uuid });
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
      .update(statusOptions)
      .set(values)
      .where(
        and(
          eq(statusOptions.orgId, orgId),
          eq(statusOptions.id, id),
          eq(statusOptions.rowVersion, expectedVersion),
        ),
      )
      .returning({ id: statusOptions.id });
    return result.length > 0;
  }

  async reorder(tx: Tx, orgId: number, orderedIds: number[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(statusOptions)
        .set({ position: index })
        .where(and(eq(statusOptions.orgId, orgId), eq(statusOptions.id, id)));
    }
  }


  /** How many contacts hold each value of one contact column (every row of the workspace, archived included). */
  async countContactsByValue(
    tx: Tx,
    orgId: number,
    column: ContactOptionColumn,
  ): Promise<Map<string, number>> {
    const col = contacts[column];
    const rows = await tx
      .select({ value: col, count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(eq(contacts.orgId, orgId))
      .groupBy(col);
    return new Map(
      rows.filter((r) => r.value !== null).map((r) => [r.value as string, Number(r.count)]),
    );
  }

  /**
   * Moves every contact holding `from` to `to`. A stage move also stamps the stage date and the previous stage,
   * exactly as a single edit of the contact does.
   */
  async reassignContacts(
    tx: Tx,
    orgId: number,
    column: ContactOptionColumn,
    from: string,
    to: string,
  ): Promise<number> {
    const set =
      column === 'lifecycleStage'
        ? {
            lifecycleStage: to,
            lifecycleStageDate: new Date(),
            previousLifecycleStage: from,
            previousLifecycleStageDate: sql`lifecycle_stage_date`,
          }
        : { [column]: to };
    const res = await tx
      .update(contacts)
      .set(set)
      .where(and(eq(contacts.orgId, orgId), eq(contacts[column], from)))
      .returning({ id: contacts.id });
    return res.length;
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(statusOptions)
      .where(and(eq(statusOptions.orgId, orgId), eq(statusOptions.id, id)))
      .returning({ id: statusOptions.id });
    return result.length > 0;
  }
}
