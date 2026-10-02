import { Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
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
  isWon: boolean;
  isLost: boolean;
  /** The lifecycle stage option a contact status is scoped to (internal id and uuid); null = every stage. */
  stageOptionId: number | null;
  stageOptionUuid: string | null;
  rowVersion: number;
}

/** The scope of an option as a condition: `stage_option_id IS NULL`, or equal to the stage's id. */
const scopeCondition = (stageOptionId: number | null): SQL =>
  stageOptionId === null
    ? isNull(statusOptions.stageOptionId)
    : eq(statusOptions.stageOptionId, stageOptionId);

/**
 * Data access for `status_options` — org-extensible enum groups such as
 * lifecycle_stage and deal_status that render as pills/dropdowns in the UI.
 */
@Injectable()
export class StatusOptionsRepository {
  /** The stage option a status is scoped to, joined for its uuid. */
  private stage = alias(statusOptions, 'stage_scope');

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
      isWon: statusOptions.isWon,
      isLost: statusOptions.isLost,
      stageOptionId: statusOptions.stageOptionId,
      stageOptionUuid: this.stage.uuid,
      rowVersion: statusOptions.rowVersion,
    };
  }

  private selectOptions(tx: Tx) {
    return tx
      .select(this.selection())
      .from(statusOptions)
      .leftJoin(
        this.stage,
        and(
          eq(this.stage.orgId, statusOptions.orgId),
          eq(this.stage.id, statusOptions.stageOptionId),
        ),
      );
  }

  async list(
    tx: Tx,
    orgId: number,
    moduleKey: ModuleKey,
    optionGroup?: string,
  ): Promise<StatusOptionRow[]> {
    const conditions = [eq(statusOptions.orgId, orgId), eq(statusOptions.moduleKey, moduleKey)];
    if (optionGroup) conditions.push(eq(statusOptions.optionGroup, optionGroup));

    return this.selectOptions(tx)
      .where(and(...conditions))
      .orderBy(asc(statusOptions.optionGroup), asc(statusOptions.position), asc(statusOptions.id));
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<StatusOptionRow | undefined> {
    const rows = await this.selectOptions(tx).where(
      and(eq(statusOptions.orgId, orgId), eq(statusOptions.uuid, uuid)),
    );
    return rows[0];
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<StatusOptionRow | undefined> {
    const rows = await this.selectOptions(tx).where(
      and(eq(statusOptions.orgId, orgId), eq(statusOptions.id, id)),
    );
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

  /**
   * Unsets the current default of one scope of a group: a group has at most one default per scope (`stageOptionId` null =
   * the group's own; a stage's id = the default status of that stage).
   */
  async clearDefault(
    tx: Tx,
    orgId: number,
    moduleKey: ModuleKey,
    optionGroup: string,
    stageOptionId: number | null = null,
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
          scopeCondition(stageOptionId),
        ),
      );
  }

  /** Whether another option of the group already is the default of this scope. */
  async scopeHasDefault(
    tx: Tx,
    orgId: number,
    moduleKey: ModuleKey,
    optionGroup: string,
    stageOptionId: number | null,
    exceptId: number,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: statusOptions.id })
      .from(statusOptions)
      .where(
        and(
          eq(statusOptions.orgId, orgId),
          eq(statusOptions.moduleKey, moduleKey),
          eq(statusOptions.optionGroup, optionGroup),
          eq(statusOptions.isDefault, true),
          ne(statusOptions.id, exceptId),
          scopeCondition(stageOptionId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * A stage is going away: the statuses scoped to it become valid in every stage, and stop being its default (an unscoped
   * default may already exist, and the database allows one per scope).
   */
  async unscopeStatuses(tx: Tx, orgId: number, stageId: number): Promise<number> {
    const res = await tx
      .update(statusOptions)
      .set({ stageOptionId: null, isDefault: false })
      .where(and(eq(statusOptions.orgId, orgId), eq(statusOptions.stageOptionId, stageId)))
      .returning({ id: statusOptions.id });
    return res.length;
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
      isWon: boolean;
      isLost: boolean;
      stageOptionId?: number | null;
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
    /** What the target stage is flagged as, so a move into won or lost is stamped like any other move. */
    target: { isWon: boolean; isLost: boolean; stageValue?: string | null } = {
      isWon: false,
      isLost: false,
    },
  ): Promise<number> {
    const now = new Date();
    const set =
      column === 'lifecycleStage'
        ? {
            lifecycleStage: to,
            lifecycleStageDate: now,
            previousLifecycleStage: from,
            previousLifecycleStageDate: sql`lifecycle_stage_date`,
            wonAt: target.isWon ? now : null,
            lostAt: target.isLost ? now : null,
          }
        : column === 'status' && target.stageValue
          ? // A status scoped to a stage can only sit on contacts of that stage: the others are left with none.
            {
              status: sql`CASE WHEN lifecycle_stage = ${target.stageValue} THEN ${to} ELSE NULL END`,
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
