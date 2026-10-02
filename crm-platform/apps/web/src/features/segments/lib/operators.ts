import {
  SEGMENT_DAYS_MAX,
  SEGMENT_LIST_MAX,
  SEGMENT_OPERATORS_BY_KIND,
  SEGMENT_TEXT_MAX,
  SEGMENT_VALUE_SHAPE,
  type SegmentFieldKind,
  type SegmentOperator,
} from '@crm/contracts';

/**
 * Operators of a segment condition and which ones each kind of field offers. The sets and the value shapes come from
 * `@crm/contracts` (the API validates with the same tables), so the builder can only draw rules the API accepts. This
 * file adds the presentation: the order a person sees, and the shape of the input an operator needs.
 */

export type FieldKind = SegmentFieldKind;
export type Operator = SegmentOperator;

export const MAX_RELATIVE_DAYS = SEGMENT_DAYS_MAX;
export const MAX_TEXT_VALUE = SEGMENT_TEXT_MAX;
export const MAX_LIST_VALUES = SEGMENT_LIST_MAX;

/**
 * The order operators are listed in (the first is what a new condition starts with). Date rules lead with the relative
 * ones ("in the last N days"), the way people think about activity; every other kind keeps the contract's order. A test
 * pins these lists to the contract's, so a new operator there cannot go missing here.
 */
const DATE_ORDER: readonly Operator[] = [
  'in_last_days',
  'more_than_days_ago',
  'equals',
  'before',
  'after',
  'on_or_before',
  'on_or_after',
  'between',
  'is_empty',
  'is_not_empty',
];

export const operatorsForKind = (kind: FieldKind): readonly Operator[] =>
  kind === 'date' ? DATE_ORDER : SEGMENT_OPERATORS_BY_KIND[kind];

/** The shape of the input an operator needs. */
export type InputKind =
  | 'none'
  | 'text'
  | 'number'
  | 'date'
  /** One choice out of the field's options. */
  | 'one'
  /** Several choices out of the field's options. */
  | 'pick'
  /** Several free-typed texts. */
  | 'tokens'
  /** Several free-typed numbers. */
  | 'numberTokens'
  | 'numberRange'
  | 'dateRange'
  | 'days';

export function inputKindOf(kind: FieldKind, operator: Operator): InputKind {
  switch (SEGMENT_VALUE_SHAPE[operator]) {
    case 'none':
      return 'none';
    case 'scalar':
      if (kind === 'text' || kind === 'search') return 'text';
      if (kind === 'number') return 'number';
      if (kind === 'date') return 'date';
      return 'one';
    case 'list':
      if (kind === 'text') return 'tokens';
      if (kind === 'number') return 'numberTokens';
      return 'pick';
    case 'range':
      return kind === 'date' ? 'dateRange' : 'numberRange';
    case 'days':
      return 'days';
  }
}
