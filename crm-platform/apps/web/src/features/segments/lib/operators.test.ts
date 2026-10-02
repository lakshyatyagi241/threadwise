import {
  SEGMENT_FIELD_KINDS,
  SEGMENT_OPERATORS,
  SEGMENT_OPERATORS_BY_KIND,
  SEGMENT_VALUE_SHAPE,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { inputKindOf, operatorsForKind } from './operators';

describe('operator availability by field kind', () => {
  it('offers exactly the operators the contract allows for every kind, only reordered', () => {
    for (const kind of SEGMENT_FIELD_KINDS) {
      expect([...operatorsForKind(kind)].sort(), kind).toEqual(
        [...SEGMENT_OPERATORS_BY_KIND[kind]].sort(),
      );
    }
  });

  it('never repeats an operator', () => {
    for (const kind of SEGMENT_FIELD_KINDS) {
      expect(new Set(operatorsForKind(kind)).size, kind).toBe(operatorsForKind(kind).length);
    }
  });

  it('leads date rules with the relative ones, other kinds with the contract order', () => {
    expect(operatorsForKind('date').slice(0, 2)).toEqual(['in_last_days', 'more_than_days_ago']);
    expect(operatorsForKind('text')[0]).toBe('equals');
    expect(operatorsForKind('tags')[0]).toBe('has_any');
    expect(operatorsForKind('boolean')).toEqual(['is_true', 'is_false']);
    expect(operatorsForKind('search')).toEqual(['matches']);
  });

  it('only tag-like kinds can test membership, only text and numbers take free lists', () => {
    expect(operatorsForKind('text')).not.toContain('has_any');
    expect(operatorsForKind('option')).not.toContain('contains');
    expect(operatorsForKind('number')).toContain('between');
    expect(operatorsForKind('text')).not.toContain('between');
  });
});

describe('the input an operator needs', () => {
  it('every operator of every kind has an input', () => {
    for (const kind of SEGMENT_FIELD_KINDS) {
      for (const op of operatorsForKind(kind))
        expect(inputKindOf(kind, op), `${kind}.${op}`).toBeTruthy();
    }
  });

  it('takes no input where the contract takes no value', () => {
    for (const op of SEGMENT_OPERATORS) {
      if (SEGMENT_VALUE_SHAPE[op] === 'none') expect(inputKindOf('text', op)).toBe('none');
    }
  });

  it('picks the input from the kind: text, number, date, choice, list, range, days', () => {
    expect(inputKindOf('text', 'contains')).toBe('text');
    expect(inputKindOf('search', 'matches')).toBe('text');
    expect(inputKindOf('number', 'gt')).toBe('number');
    expect(inputKindOf('date', 'before')).toBe('date');
    expect(inputKindOf('date', 'equals')).toBe('date');
    expect(inputKindOf('option', 'equals')).toBe('one');
    expect(inputKindOf('user', 'equals')).toBe('one');
    expect(inputKindOf('option', 'in')).toBe('pick');
    expect(inputKindOf('tags', 'has_all')).toBe('pick');
    expect(inputKindOf('text', 'in')).toBe('tokens');
    expect(inputKindOf('number', 'not_in')).toBe('numberTokens');
    expect(inputKindOf('number', 'between')).toBe('numberRange');
    expect(inputKindOf('date', 'between')).toBe('dateRange');
    expect(inputKindOf('date', 'in_last_days')).toBe('days');
    expect(inputKindOf('date', 'more_than_days_ago')).toBe('days');
  });
});
