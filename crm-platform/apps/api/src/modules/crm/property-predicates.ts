import { sql, type SQL } from 'drizzle-orm';
import type { SegmentFieldKind, SegmentOperator } from '@crm/contracts';
import {
  booleanTextPredicate,
  datePredicate,
  multiPredicate,
  numberPredicate,
  textPredicate,
  type DateOperator,
  type NumberOperator,
  type SetOperator,
  type TextOperator,
} from './contacts/contact-predicates';

/** The scalar or list operand as strings (empty for operators without one). */
export function operandStrings(value: unknown): string[] {
  if (value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value)))
    return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

/**
 * One condition on a custom property stored in a jsonb `data` column (`contacts.data`, `companies.data`), through the predicates the
 * contact list, the bulk actions and the segments share. `data` is the column as SQL (already table-qualified), the key is bound as
 * a parameter. The kind and the value are validated by the caller (`checkConditionValue`); an operator that does not suit the kind
 * is answered with `undefined`, never with SQL.
 *
 * One definition for contacts and companies, so "equals", "between" or "has any" read the same wherever a property is filtered.
 */
export function propertyPredicate(
  data: SQL,
  key: string,
  kind: SegmentFieldKind,
  op: SegmentOperator,
  value: unknown,
  tz = 'UTC',
): SQL | undefined {
  const asText = sql`(${data} ->> ${key}::text)`;
  switch (kind) {
    case 'text':
      return textPredicate(asText, op as TextOperator, value);
    case 'option':
      return textPredicate(asText, op as TextOperator, value, { exact: true });
    case 'number':
      return numberPredicate(sql`segment_safe_numeric(${asText})`, op as NumberOperator, value);
    case 'date':
      return datePredicate(sql`segment_safe_timestamptz(${asText})`, op as DateOperator, value, tz);
    case 'boolean':
      return booleanTextPredicate(asText, op === 'is_true');
    case 'multi':
      return multiPredicate(
        sql`(${data} -> ${key}::text)`,
        op as SetOperator,
        operandStrings(value),
      );
    default:
      return undefined;
  }
}

/** The kinds a list can be ordered by, and how: the SQL type of the sort key and the expression that produces it. */
export type PropertySortType = 'text' | 'numeric' | 'timestamptz';

export interface PropertySort {
  type: PropertySortType;
  /** The key as a value of its type; empty values take the lowest key, so they come first when ascending. */
  expr: SQL;
}

/**
 * How to order by a property. Text and option sort case-insensitively; a number, a date and a checkbox by their value. A property
 * that holds several values (multi-select) or is computed has no order, so the answer is `undefined`.
 */
export function propertySort(
  data: SQL,
  key: string,
  kind: SegmentFieldKind,
): PropertySort | undefined {
  const asText = sql`(${data} ->> ${key}::text)`;
  switch (kind) {
    case 'text':
    case 'option':
      return { type: 'text', expr: sql`lower(coalesce(${asText}, ''))` };
    case 'number':
      return {
        type: 'numeric',
        expr: sql`coalesce(segment_safe_numeric(${asText}), -1e30::numeric)`,
      };
    case 'date':
      return {
        type: 'timestamptz',
        expr: sql`coalesce(segment_safe_timestamptz(${asText}), '-infinity'::timestamptz)`,
      };
    case 'boolean':
      return {
        type: 'numeric',
        expr: sql`(CASE WHEN lower(coalesce(${asText}, '')) IN ('true', 't', '1', 'yes') THEN 1 ELSE 0 END)::numeric`,
      };
    default:
      return undefined;
  }
}
