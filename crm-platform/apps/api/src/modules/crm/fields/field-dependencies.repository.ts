import { Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';

const { fieldDependencies, fieldOptionDependencies, fields, fieldOptions } = schema;

export interface FieldDependencyRow {
  id: number;
  uuid: string;
  fieldId: number;
  fieldUuid: string;
  /** The dependent field's moduleKey (fieldId, not dependsOnFieldId) — that's the row being gated. */
  moduleKey: string;
  dependsOnFieldId: number;
  dependsOnFieldUuid: string;
  dependsOnOptionId: number | null;
  dependsOnOptionUuid: string | null;
  dependsOnValue: string | null;
  createdAt: Date;
}

export interface FieldOptionDependencyRow {
  id: number;
  uuid: string;
  parentOptionId: number;
  parentOptionUuid: string;
  parentFieldUuid: string;
  /** The parent option's owning field's moduleKey — same reasoning as above. */
  moduleKey: string;
  childOptionId: number;
  childOptionUuid: string;
  childFieldUuid: string;
  createdAt: Date;
}

/** A child-option pair to store: the parent option and the child option it allows (internal ids). */
export interface OptionPairValues {
  parentOptionId: number;
  childOptionId: number;
}

const dependentField = alias(fields, 'dependent_field');
const parentField = alias(fields, 'parent_field');
const dependsOnOption = alias(fieldOptions, 'depends_on_option');
const parentOption = alias(fieldOptions, 'parent_option');
const childOption = alias(fieldOptions, 'child_option');
const parentOptionField = alias(fields, 'parent_option_field');
const childOptionField = alias(fields, 'child_option_field');

/**
 * Data access for the two dependency tables. field_dependencies is
 * field-level (shows/hides a whole field); field_option_dependencies is
 * option-level (which child options a parent option permits).
 */
@Injectable()
export class FieldDependenciesRepository {
  private dependencySelection() {
    return {
      id: fieldDependencies.id,
      uuid: fieldDependencies.uuid,
      fieldId: fieldDependencies.fieldId,
      fieldUuid: dependentField.uuid,
      moduleKey: dependentField.moduleKey,
      dependsOnFieldId: fieldDependencies.dependsOnFieldId,
      dependsOnFieldUuid: parentField.uuid,
      dependsOnOptionId: fieldDependencies.dependsOnOptionId,
      dependsOnOptionUuid: dependsOnOption.uuid,
      dependsOnValue: fieldDependencies.dependsOnValue,
      createdAt: fieldDependencies.createdAt,
    };
  }

  private dependencyBaseQuery(tx: Tx) {
    return tx
      .select(this.dependencySelection())
      .from(fieldDependencies)
      .innerJoin(
        dependentField,
        and(
          eq(dependentField.orgId, fieldDependencies.orgId),
          eq(dependentField.id, fieldDependencies.fieldId),
        ),
      )
      .innerJoin(
        parentField,
        and(
          eq(parentField.orgId, fieldDependencies.orgId),
          eq(parentField.id, fieldDependencies.dependsOnFieldId),
        ),
      )
      .leftJoin(
        dependsOnOption,
        and(
          eq(dependsOnOption.orgId, fieldDependencies.orgId),
          eq(dependsOnOption.id, fieldDependencies.dependsOnOptionId),
        ),
      );
  }

  async listByField(tx: Tx, orgId: number, fieldId: number): Promise<FieldDependencyRow[]> {
    return this.dependencyBaseQuery(tx).where(
      and(eq(fieldDependencies.orgId, orgId), eq(fieldDependencies.fieldId, fieldId)),
    ) as Promise<FieldDependencyRow[]>;
  }

  /** Every dependency of the fields of one module, for the properties list and the contact form. */
  async listByModule(tx: Tx, orgId: number, moduleKey: string): Promise<FieldDependencyRow[]> {
    return this.dependencyBaseQuery(tx).where(
      and(eq(fieldDependencies.orgId, orgId), eq(dependentField.moduleKey, moduleKey)),
    ) as Promise<FieldDependencyRow[]>;
  }

  /** Every field-dependency edge in the org — cheap; this table is a handful of rows per org. */
  private async listAllEdges(
    tx: Tx,
    orgId: number,
  ): Promise<Array<{ fieldId: number; dependsOnFieldId: number }>> {
    return tx
      .select({
        fieldId: fieldDependencies.fieldId,
        dependsOnFieldId: fieldDependencies.dependsOnFieldId,
      })
      .from(fieldDependencies)
      .where(eq(fieldDependencies.orgId, orgId));
  }

  /**
   * True if adding `fieldId -> dependsOnFieldId` would close a cycle, i.e.
   * `dependsOnFieldId` already (transitively) depends on `fieldId`.
   */
  async wouldCreateCycle(
    tx: Tx,
    orgId: number,
    fieldId: number,
    dependsOnFieldId: number,
  ): Promise<boolean> {
    if (fieldId === dependsOnFieldId) return true;

    const edges = await this.listAllEdges(tx, orgId);
    const byField = new Map<number, number[]>();
    for (const edge of edges) {
      const list = byField.get(edge.fieldId) ?? [];
      list.push(edge.dependsOnFieldId);
      byField.set(edge.fieldId, list);
    }

    const seen = new Set<number>();
    const stack = [dependsOnFieldId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === fieldId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(byField.get(current) ?? []));
    }
    return false;
  }

  async insertFieldDependency(
    tx: Tx,
    orgId: number,
    values: {
      fieldId: number;
      dependsOnFieldId: number;
      dependsOnOptionId?: number | null;
      dependsOnValue?: string | null;
    },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(fieldDependencies)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        fieldId: values.fieldId,
        dependsOnFieldId: values.dependsOnFieldId,
        dependsOnOptionId: values.dependsOnOptionId ?? null,
        dependsOnValue: values.dependsOnValue ?? null,
      })
      .returning({ id: fieldDependencies.id, uuid: fieldDependencies.uuid });
    return row!;
  }

  async findDependencyByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<FieldDependencyRow | undefined> {
    const rows = await this.dependencyBaseQuery(tx).where(
      and(eq(fieldDependencies.orgId, orgId), eq(fieldDependencies.uuid, uuid)),
    );
    return rows[0] as FieldDependencyRow | undefined;
  }

  async deleteFieldDependency(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(fieldDependencies)
      .where(and(eq(fieldDependencies.orgId, orgId), eq(fieldDependencies.id, id)))
      .returning({ id: fieldDependencies.id });
    return result.length > 0;
  }

  private optionDependencySelection() {
    return {
      id: fieldOptionDependencies.id,
      uuid: fieldOptionDependencies.uuid,
      parentOptionId: fieldOptionDependencies.parentOptionId,
      parentOptionUuid: parentOption.uuid,
      parentFieldUuid: parentOptionField.uuid,
      moduleKey: parentOptionField.moduleKey,
      childOptionId: fieldOptionDependencies.childOptionId,
      childOptionUuid: childOption.uuid,
      childFieldUuid: childOptionField.uuid,
      createdAt: fieldOptionDependencies.createdAt,
    };
  }

  private optionDependencyBaseQuery(tx: Tx) {
    return tx
      .select(this.optionDependencySelection())
      .from(fieldOptionDependencies)
      .innerJoin(
        parentOption,
        and(
          eq(parentOption.orgId, fieldOptionDependencies.orgId),
          eq(parentOption.id, fieldOptionDependencies.parentOptionId),
        ),
      )
      .innerJoin(
        childOption,
        and(
          eq(childOption.orgId, fieldOptionDependencies.orgId),
          eq(childOption.id, fieldOptionDependencies.childOptionId),
        ),
      )
      .innerJoin(
        parentOptionField,
        and(
          eq(parentOptionField.orgId, parentOption.orgId),
          eq(parentOptionField.id, parentOption.fieldId),
        ),
      )
      .innerJoin(
        childOptionField,
        and(
          eq(childOptionField.orgId, childOption.orgId),
          eq(childOptionField.id, childOption.fieldId),
        ),
      );
  }

  /** Every option-level pair of the fields of one module, for the properties screen and the contact form. */
  async listOptionDependenciesByModule(
    tx: Tx,
    orgId: number,
    moduleKey: string,
  ): Promise<FieldOptionDependencyRow[]> {
    return this.optionDependencyBaseQuery(tx).where(
      and(eq(fieldOptionDependencies.orgId, orgId), eq(parentOptionField.moduleKey, moduleKey)),
    ) as Promise<FieldOptionDependencyRow[]>;
  }

  /** Store option pairs as they are; the caller has checked that each option belongs to the right field. */
  async insertOptionPairs(
    tx: Tx,
    orgId: number,
    pairs: readonly OptionPairValues[],
  ): Promise<void> {
    if (pairs.length === 0) return;
    await tx.insert(fieldOptionDependencies).values(
      pairs.map((p) => ({
        orgId,
        uuid: sql`gen_random_uuid()`,
        parentOptionId: p.parentOptionId,
        childOptionId: p.childOptionId,
      })),
    );
  }

  /**
   * Remove the option pairs that make `childFieldId`'s choices depend on `parentFieldId`'s (or on any parent, when none is given):
   * a pair belongs to the child when its child option is one of the child's options.
   */
  async deleteOptionPairsOfChild(
    tx: Tx,
    orgId: number,
    childFieldId: number,
    parentFieldId?: number,
  ): Promise<void> {
    const childOptionIds = tx
      .select({ id: fieldOptions.id })
      .from(fieldOptions)
      .where(and(eq(fieldOptions.orgId, orgId), eq(fieldOptions.fieldId, childFieldId)));
    const parentOptionIds =
      parentFieldId === undefined
        ? undefined
        : tx
            .select({ id: fieldOptions.id })
            .from(fieldOptions)
            .where(and(eq(fieldOptions.orgId, orgId), eq(fieldOptions.fieldId, parentFieldId)));
    await tx
      .delete(fieldOptionDependencies)
      .where(
        and(
          eq(fieldOptionDependencies.orgId, orgId),
          inArray(fieldOptionDependencies.childOptionId, childOptionIds),
          parentOptionIds
            ? inArray(fieldOptionDependencies.parentOptionId, parentOptionIds)
            : undefined,
        ),
      );
  }

  /**
   * Remove every cascade link of a field: a field-level dependency that names neither an option nor a value. Returns how many
   * went. A "show only when" rule of the same field is left alone.
   */
  async deleteCascadeLinks(tx: Tx, orgId: number, fieldId: number): Promise<number> {
    const result = await tx
      .delete(fieldDependencies)
      .where(
        and(
          eq(fieldDependencies.orgId, orgId),
          eq(fieldDependencies.fieldId, fieldId),
          isNull(fieldDependencies.dependsOnOptionId),
          isNull(fieldDependencies.dependsOnValue),
        ),
      )
      .returning({ id: fieldDependencies.id });
    return result.length;
  }

  async listOptionDependenciesByParent(
    tx: Tx,
    orgId: number,
    parentOptionId: number,
  ): Promise<FieldOptionDependencyRow[]> {
    return this.optionDependencyBaseQuery(tx).where(
      and(
        eq(fieldOptionDependencies.orgId, orgId),
        eq(fieldOptionDependencies.parentOptionId, parentOptionId),
      ),
    ) as Promise<FieldOptionDependencyRow[]>;
  }

  async findOptionDependencyByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<FieldOptionDependencyRow | undefined> {
    const rows = await this.optionDependencyBaseQuery(tx).where(
      and(eq(fieldOptionDependencies.orgId, orgId), eq(fieldOptionDependencies.uuid, uuid)),
    );
    return rows[0] as FieldOptionDependencyRow | undefined;
  }

  async insertOptionDependency(
    tx: Tx,
    orgId: number,
    values: { parentOptionId: number; childOptionId: number },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(fieldOptionDependencies)
      .values({ orgId, uuid: sql`gen_random_uuid()`, ...values })
      .returning({ id: fieldOptionDependencies.id, uuid: fieldOptionDependencies.uuid });
    return row!;
  }

  async deleteOptionDependency(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(fieldOptionDependencies)
      .where(and(eq(fieldOptionDependencies.orgId, orgId), eq(fieldOptionDependencies.id, id)))
      .returning({ id: fieldOptionDependencies.id });
    return result.length > 0;
  }
}
