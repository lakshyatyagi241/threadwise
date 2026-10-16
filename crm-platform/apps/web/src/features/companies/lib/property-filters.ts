import {
  segmentKindForFieldType,
  type CompanyPropertyFilter,
  type FieldResponse,
  type SegmentOperator,
} from '@crm/contracts';
import {
  fromWire,
  operatorsForKind,
  toWire,
  valueProblem,
  conditionsOf,
  type Condition,
  type FieldDef,
  type Group,
} from '@/features/segments';

/**
 * Conditions on company properties for the Companies list (BL-196). The vocabulary is the segment builder's, so a property is
 * filtered with the operators its kind has everywhere else (text contains, number between, date in the last N days, option is one
 * of, checkbox is true...). The list keeps them in the address as `props=[{key, operator, value}]`; this file turns that into the
 * builder's editor values and back. Everything here is pure.
 */

/** The properties a list can filter or order by: the workspace's own, active, visible, stored, and not masked. */
export function filterableFields(fields: readonly FieldResponse[]): FieldDef[] {
  return fields.flatMap((f): FieldDef[] => {
    if (!f.isActive || f.isSystem || f.isHidden || f.isMasked) return [];
    const kind = segmentKindForFieldType(f.fieldType);
    if (!kind) return [];
    return [
      {
        id: f.key,
        group: 'properties',
        kind,
        label: { text: f.label },
        operators: operatorsForKind(kind),
        ...(kind === 'option' || kind === 'multi'
          ? {
              options: (f.options ?? []).map((o) => ({ value: o.value, label: o.label })),
              optionsFrom: 'property' as const,
            }
          : {}),
      },
    ];
  });
}

/** The kinds a list can be ordered by (a multi-select has no order). */
export const isSortableKind = (kind: FieldDef['kind']): boolean =>
  kind === 'text' ||
  kind === 'option' ||
  kind === 'number' ||
  kind === 'date' ||
  kind === 'boolean';

/** The editor's conditions for the conditions in the address, leaving out those of a property that is gone. */
export function conditionsFromProps(
  props: readonly CompanyPropertyFilter[],
  catalog: readonly FieldDef[],
): Group {
  const known = new Set(catalog.map((f) => f.id));
  return fromWire({
    type: 'group',
    combinator: 'and',
    children: props
      .filter((p) => known.has(p.key))
      .map((p) => ({
        type: 'condition' as const,
        field: p.key,
        operator: p.operator,
        ...(p.value === undefined ? {} : { value: p.value }),
      })),
  });
}

/** The conditions to put in the address: complete ones only (a half-filled row is left out, not sent). */
export function propsFromConditions(
  root: Group,
  catalog: readonly FieldDef[],
): CompanyPropertyFilter[] {
  const wire = toWire(root, catalog);
  return wire.children.flatMap((n): CompanyPropertyFilter[] =>
    n.type === 'condition'
      ? [
          {
            key: n.field,
            operator: n.operator as SegmentOperator,
            ...(n.value === undefined ? {} : { value: n.value }),
          },
        ]
      : [],
  );
}

/** Whether a row of the editor is complete enough to apply. */
export function isComplete(c: Condition, catalog: readonly FieldDef[]): boolean {
  const field = catalog.find((f) => f.id === c.field);
  return field !== undefined && valueProblem(c, field.kind) === null;
}

/** How many rows of the editor are complete. */
export const completeCount = (root: Group, catalog: readonly FieldDef[]): number =>
  conditionsOf(root).filter((c) => isComplete(c, catalog)).length;
