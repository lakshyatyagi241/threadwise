import { describe, expect, it } from 'vitest';
import {
  SEGMENT_BUILTIN_FIELDS,
  SEGMENT_DAYS_MAX,
  SEGMENT_FIELD_KINDS,
  SEGMENT_OPERATORS_BY_KIND,
  SEGMENT_VALUE_SHAPE,
  builtinFieldKind,
  checkConditionValue,
  customFieldKey,
  isCustomSegmentField,
  type SegmentFieldKind,
  type SegmentOperator,
} from '@crm/contracts';

/** Segment rule helpers (QA task 5). Worked by hand from the operator table in contracts/src/segments/rules.ts. */

const UUID = '11111111-1111-4111-8111-111111111111';
const check = (kind: SegmentFieldKind, op: SegmentOperator, value?: unknown) =>
  checkConditionValue(kind, op, value);

describe('the field and operator tables agree with each other', () => {
  it('every built-in field has a known kind', () => {
    for (const [field, kind] of Object.entries(SEGMENT_BUILTIN_FIELDS)) {
      expect(SEGMENT_FIELD_KINDS, field).toContain(kind);
    }
  });
  it('every operator of every kind has a value shape, so no operator is accepted without a rule for its value', () => {
    for (const [kind, ops] of Object.entries(SEGMENT_OPERATORS_BY_KIND)) {
      for (const op of ops) expect(SEGMENT_VALUE_SHAPE[op], `${kind}/${op}`).toBeDefined();
    }
  });
  it('every kind has at least one operator', () => {
    for (const kind of SEGMENT_FIELD_KINDS)
      expect(SEGMENT_OPERATORS_BY_KIND[kind].length, kind).toBeGreaterThan(0);
  });
});

describe('field names', () => {
  it.each([
    ['name', 'text'],
    ['leadScore', 'number'],
    ['createdAt', 'date'],
    ['tags', 'tags'],
    ['unsubscribed', 'boolean'],
    ['search', 'search'],
  ])('builtinFieldKind(%s) is %s', (field, kind) => {
    expect(builtinFieldKind(field)).toBe(kind);
  });
  it('knows nothing of a custom field, an unknown one, or a name that exists on every object', () => {
    expect(builtinFieldKind('custom.plan')).toBeUndefined();
    expect(builtinFieldKind('nope')).toBeUndefined();
    expect(builtinFieldKind('constructor')).toBeUndefined();
    expect(builtinFieldKind('toString')).toBeUndefined();
    expect(builtinFieldKind('__proto__')).toBeUndefined();
  });
  it('isCustomSegmentField and customFieldKey split "custom.<key>"', () => {
    expect(isCustomSegmentField('custom.plan_tier')).toBe(true);
    expect(isCustomSegmentField('plan')).toBe(false);
    expect(isCustomSegmentField('customer')).toBe(false);
    expect(customFieldKey('custom.plan_tier')).toBe('plan_tier');
  });
});

describe('checkConditionValue: which operator a field kind has', () => {
  it('refuses an operator the kind does not have, and names both', () => {
    expect(check('text', 'gt', 5)).toBe('operator "gt" is not available for a text field');
    expect(check('boolean', 'equals', true)).toBe(
      'operator "equals" is not available for a boolean field',
    );
    expect(check('tags', 'equals', UUID)).toBe(
      'operator "equals" is not available for a tags field',
    );
  });
});

describe('checkConditionValue: the shape of the value', () => {
  it('no value for is_empty and is_true; a value is refused', () => {
    expect(check('text', 'is_empty')).toBeNull();
    expect(check('boolean', 'is_true')).toBeNull();
    expect(check('text', 'is_empty', 'x')).toBe('"is_empty" takes no value');
  });
  it('a scalar operator needs one value of the right kind', () => {
    expect(check('text', 'equals', 'abc')).toBeNull();
    expect(check('text', 'equals')).toBe('"equals" needs a value');
    expect(check('text', 'equals', '   ')).toBe('text is required');
    expect(check('text', 'equals', 5)).toBe('text is required');
    expect(check('text', 'equals', ['a'])).toBe('"equals" takes a single value');
    expect(check('text', 'equals', { a: 1 })).toBe('"equals" takes a single value');
    expect(check('number', 'gt', 5)).toBeNull();
    expect(check('number', 'gt', 0)).toBeNull();
    expect(check('number', 'gt', '5')).toBe('a number is required');
  });
  it('a list operator needs a list whose every item is valid', () => {
    expect(check('text', 'in', ['a', 'b'])).toBeNull();
    expect(check('text', 'in', 'a')).toBe('"in" takes a list of values');
    expect(check('text', 'in', ['a', ''])).toBe('text is required');
    expect(check('tags', 'has_any', [UUID])).toBeNull();
    expect(check('tags', 'has_any', ['not-an-id'])).toBe('an id (uuid) is required');
    expect(check('tags', 'has_any', [])).toBeNull();
  });
  it('between needs { from, to } in order', () => {
    expect(check('number', 'between', { from: 1, to: 5 })).toBeNull();
    expect(check('number', 'between', { from: 5, to: 5 })).toBeNull();
    expect(check('number', 'between', { from: 10, to: 5 })).toBe('"from" is after "to"');
    expect(check('number', 'between', [1, 5])).toBe('"between" takes { from, to }');
    expect(check('number', 'between', { from: 1 })).toBe('a number is required');
    expect(check('date', 'between', { from: '2026-01-01', to: '2026-06-01' })).toBeNull();
    expect(check('date', 'between', { from: '2026-06-01', to: '2026-01-01' })).toBe(
      '"from" is after "to"',
    );
  });
  it('a date operator takes a date or a date-time and refuses other text', () => {
    expect(check('date', 'before', '2026-01-01')).toBeNull();
    expect(check('date', 'after', '2026-01-01T10:00:00Z')).toBeNull();
    expect(check('date', 'before', 'next tuesday')).toBe(
      'a date (YYYY-MM-DD) or ISO date-time is required',
    );
  });
  it('day-count operators take a whole number from 0 to the maximum', () => {
    expect(check('date', 'in_last_days', 30)).toBeNull();
    expect(check('date', 'in_last_days', 0)).toBeNull();
    expect(check('date', 'in_last_days', SEGMENT_DAYS_MAX)).toBeNull();
    const msg = `a whole number of days from 0 to ${SEGMENT_DAYS_MAX} is required`;
    expect(check('date', 'in_last_days', SEGMENT_DAYS_MAX + 1)).toBe(msg);
    expect(check('date', 'in_last_days', -1)).toBe(msg);
    expect(check('date', 'more_than_days_ago', 1.5)).toBe(msg);
    expect(check('date', 'more_than_days_ago', '30')).toBe(msg);
  });
  it('a search takes text of 1 to 200 characters', () => {
    expect(check('search', 'matches', 'anna')).toBeNull();
    expect(check('search', 'matches', 'x'.repeat(200))).toBeNull();
    expect(check('search', 'matches', 'x'.repeat(201))).toBe(
      'text of 1 to 200 characters is required',
    );
    expect(check('search', 'matches', ' ')).toBe('text of 1 to 200 characters is required');
  });
});
